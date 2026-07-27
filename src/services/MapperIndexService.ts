// services/MapperIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { parseJavaMapper, parseXmlMapper } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaMapperType, XmlMapperType, XmlStatementType } from "@exportTypes";

const SYNC_DEBOUNCE_MS = 200;
const INDEX_CONCURRENCY = 32;
const GLOB_ESCAPE_PATTERN = /[\\^$.|+()[\]{}]/;

interface IndexedJavaMapper {
  mapper: JavaMapperType;
  uri: vscode.Uri;
}

interface DocCacheEntry<T> {
  mapper: T | null;
  version: number;
}

export const MapperIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const xmlIndex = new Map<string, XmlMapperType>();
  const namespaceIndex = new Map<string, Set<string>>();
  const javaIndex = new Map<string, IndexedJavaMapper>();
  const javaPathIndex = new Map<string, string>();
  const xmlDocCache = new WeakMap<vscode.TextDocument, DocCacheEntry<XmlMapperType>>();
  const javaDocCache = new WeakMap<vscode.TextDocument, DocCacheEntry<JavaMapperType>>();
  const decoder = new TextDecoder(`utf-8`);
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  let watchers: vscode.FileSystemWatcher[] = [];
  let excludeRegexes: RegExp[] = [];
  let excludeSignature: string | null = null;

  // 1-1. 스캔 제외 설정/글롭 생성
  const getExcludeList = (): string[] => vscode.workspace.getConfiguration(`Mybatis-Booster`).get<string[]>(`searchExclude`, []);
  const getExcludeGlob = (): string | undefined => {
    const list = getExcludeList();
    return list.length > 0 ? `{${list.join(`,`)}}` : undefined;
  };

  // 1-2. 글롭 -> 정규식 변환 (워처 이벤트 제외 필터용)
  const globToRegex = (glob: string): RegExp => {
    let pattern = ``;
    let i = 0;
    while (i < glob.length) {
      const char = glob[i];
      if (char === `*` && glob[i + 1] === `*`) {
        pattern += glob[i + 2] === `/` ? `(?:.*/)?` : `.*`;
        i += glob[i + 2] === `/` ? 3 : 2;
      }
      else if (char === `*`) {
        pattern += `[^/]*`;
        i += 1;
      }
      else if (char === `?`) {
        pattern += `[^/]`;
        i += 1;
      }
      else {
        pattern += GLOB_ESCAPE_PATTERN.test(char) ? `\\${char}` : char;
        i += 1;
      }
    }
    return new RegExp(`^${pattern}$`);
  };

  // 1-3. 제외 경로 여부 (searchExclude 변경 시 재컴파일)
  const isExcludedPath = (uri: vscode.Uri): boolean => {
    const list = getExcludeList();
    const signature = list.join(`|`);
    if (signature !== excludeSignature) {
      excludeSignature = signature;
      excludeRegexes = list.map(globToRegex);
    }
    if (excludeRegexes.length === 0) {
      return false;
    }
    const relative = vscode.workspace.asRelativePath(uri, false).replaceAll(`\\`, `/`);
    return excludeRegexes.some((regex) => regex.test(relative));
  };

  // 1-4. XML 인덱스 등록/제거 (네임스페이스 역인덱스 동기화)
  const removeXml = (fsPath: string): void => {
    const prev = xmlIndex.get(fsPath);
    if (prev) {
      const paths = namespaceIndex.get(prev.namespace);
      paths?.delete(fsPath);
      paths && paths.size === 0 && namespaceIndex.delete(prev.namespace);
    }
    xmlIndex.delete(fsPath);
  };
  const setXml = (fsPath: string, mapper: XmlMapperType): void => {
    removeXml(fsPath);
    xmlIndex.set(fsPath, mapper);
    const paths = namespaceIndex.get(mapper.namespace) ?? new Set<string>();
    paths.add(fsPath);
    namespaceIndex.set(mapper.namespace, paths);
  };

  // 1-5. 단일 XML 파일 인덱싱
  const indexFile = async (uri: vscode.Uri): Promise<void> => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const mapper = parseXmlMapper(uri.fsPath, decoder.decode(bytes));
      mapper ? setXml(uri.fsPath, mapper) : removeXml(uri.fsPath);
    }
    catch {
      removeXml(uri.fsPath);
    }
  };

  // 1-6. Java mapper 인덱스 등록/제거
  const removeJava = (fsPath: string): void => {
    const namespace = javaPathIndex.get(fsPath);
    namespace && javaIndex.delete(namespace);
    javaPathIndex.delete(fsPath);
  };
  const setJava = (uri: vscode.Uri, mapper: JavaMapperType): void => {
    const namespace = `${mapper.packageName}.${mapper.interfaceName}`;
    javaIndex.set(namespace, { mapper, uri });
    javaPathIndex.set(uri.fsPath, namespace);
  };

  // 1-7. 단일 Java 파일 인덱싱
  const indexJavaFile = async (uri: vscode.Uri): Promise<void> => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const mapper = parseJavaMapper(decoder.decode(bytes));
      removeJava(uri.fsPath);
      mapper && setJava(uri, mapper);
    }
    catch {
      removeJava(uri.fsPath);
    }
  };

  // 1-8. 동시 실행 제한 실행기 (대형 워크스페이스 IO 폭주 방지)
  const runPooled = async (jobs: Array<() => Promise<void>>): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < jobs.length) {
        const index = cursor;
        cursor += 1;
        // biome-ignore lint/performance/noAwaitInLoops: 워커별 순차 실행으로 동시성 상한을 유지함
        await jobs[index]();
      }
    };
    await Promise.all(Array.from({ "length": Math.min(INDEX_CONCURRENCY, jobs.length) }, () => worker()));
  };

  // 1-9. 워크스페이스 전체 스캔
  const scan = async (): Promise<number> => {
    xmlIndex.clear();
    namespaceIndex.clear();
    javaIndex.clear();
    javaPathIndex.clear();
    const excludeGlob = getExcludeGlob();
    const [xmlUris, javaUris] = await Promise.all([
      vscode.workspace.findFiles(`**/*.xml`, excludeGlob),
      vscode.workspace.findFiles(`**/*.java`, excludeGlob),
    ]);
    await runPooled([
      ...xmlUris.map((uri) => () => indexFile(uri)),
      ...javaUris.map((uri) => () => indexJavaFile(uri)),
    ]);
    logger(`debug`, `scan - ${xmlUris.length} xml files checked, ${xmlIndex.size} mappers indexed`);
    logger(`debug`, `scan - ${javaUris.length} java files checked, ${javaIndex.size} mappers indexed`);
    return xmlIndex.size;
  };

  // 1-10. 열린 XML 문서 동기 파싱 (문서 버전 캐시)
  const syncDoc = (document: vscode.TextDocument): XmlMapperType | null => {
    const cached = xmlDocCache.get(document);
    if (cached && cached.version === document.version) {
      cached.mapper && xmlIndex.get(document.uri.fsPath) !== cached.mapper && setXml(document.uri.fsPath, cached.mapper);
      return cached.mapper;
    }
    const mapper = parseXmlMapper(document.uri.fsPath, document.getText());
    mapper ? setXml(document.uri.fsPath, mapper) : removeXml(document.uri.fsPath);
    xmlDocCache.set(document, { mapper, "version": document.version });
    return mapper;
  };

  // 1-11. 열린 Java 문서 파싱 (문서 버전 캐시, 인덱스 동기화 겸용)
  const getJavaMapper = (document: vscode.TextDocument): JavaMapperType | null => {
    const cached = javaDocCache.get(document);
    if (cached && cached.version === document.version) {
      if (cached.mapper) {
        const namespace = `${cached.mapper.packageName}.${cached.mapper.interfaceName}`;
        javaIndex.get(namespace)?.mapper !== cached.mapper && setJava(document.uri, cached.mapper);
      }
      return cached.mapper;
    }
    const mapper = parseJavaMapper(document.getText());
    removeJava(document.uri.fsPath);
    mapper && setJava(document.uri, mapper);
    javaDocCache.set(document, { mapper, "version": document.version });
    return mapper;
  };

  // 1-12. 경로/네임스페이스 조회
  const getXmlByPath = (fsPath: string): XmlMapperType | undefined => xmlIndex.get(fsPath);
  const findXmlByNamespace = (namespace: string): XmlMapperType[] => {
    const paths = namespaceIndex.get(namespace);
    if (!paths) {
      return [];
    }
    const mappers: XmlMapperType[] = [];
    for (const fsPath of paths) {
      const mapper = xmlIndex.get(fsPath);
      mapper && mappers.push(mapper);
    }
    return mappers;
  };

  // 1-13. 인터페이스 단순명으로 Java namespace 후보 조회 (namespace 오타 진단용)
  const findJavaBySimpleName = (interfaceName: string): string[] => {
    const namespaces: string[] = [];
    for (const [namespace, indexed] of javaIndex) {
      indexed.mapper.interfaceName === interfaceName && namespaces.push(namespace);
    }
    return namespaces;
  };

  // 1-13-1. namespace 마지막 세그먼트로 XML mapper 조회 (로그 약층 로거명 역추적용)
  const findXmlBySimpleName = (simpleName: string): XmlMapperType[] => {
    const mappers: XmlMapperType[] = [];
    for (const namespace of namespaceIndex.keys()) {
      namespace.split(`.`).at(-1) === simpleName && mappers.push(...findXmlByNamespace(namespace));
    }
    return mappers;
  };

  // 1-13-2. namespace 전체 파일에서 statement 탐색 (동일 namespace 분할 파일 지원)
  const findStatementByNamespace = (namespace: string, statementId: string): { mapper: XmlMapperType; statement: XmlStatementType } | undefined => {
    for (const mapper of findXmlByNamespace(namespace)) {
      const statement = mapper.statements.find((item) => item.id === statementId);
      if (statement) {
        return { mapper, statement };
      }
    }
    return undefined;
  };

  // 1-14. 네임스페이스로 Java mapper 조회 (인덱스 우선, 미스 시 파일 검색)
  const findJavaByNamespace = async (namespace: string): Promise<IndexedJavaMapper | undefined> => {
    const indexed = javaIndex.get(namespace);
    if (indexed) {
      return indexed;
    }
    const relative = namespace.replace(/\./g, `/`);
    const uris = await vscode.workspace.findFiles(`**/${relative}.java`, getExcludeGlob(), 1);
    uris[0] && await indexJavaFile(uris[0]);
    return javaIndex.get(namespace);
  };

  // 1-15. XML/Java 변경 감시 (경로별 debounce, 제외 경로 무시)
  const watch = (onUpdate: () => void): vscode.Disposable => {
    const xmlWatcher = vscode.workspace.createFileSystemWatcher(`**/*.xml`);
    const javaWatcher = vscode.workspace.createFileSystemWatcher(`**/*.java`);
    watchers = [xmlWatcher, javaWatcher];
    const schedule = (uri: vscode.Uri, removed: boolean, kind: `xml` | `java`): void => {
      if (isExcludedPath(uri)) {
        return;
      }
      const key = `${kind}:${uri.fsPath}`;
      const prev = pendingTimers.get(key);
      prev && clearTimeout(prev);
      pendingTimers.set(key, setTimeout(() => {
        pendingTimers.delete(key);
        removed ? (() => {
            kind === `xml` ? removeXml(uri.fsPath) : removeJava(uri.fsPath);
            onUpdate();
          })() : (kind === `xml` ? indexFile(uri) : indexJavaFile(uri)).then(onUpdate);
      }, SYNC_DEBOUNCE_MS));
    };
    xmlWatcher.onDidCreate((uri) => schedule(uri, false, `xml`));
    xmlWatcher.onDidChange((uri) => schedule(uri, false, `xml`));
    xmlWatcher.onDidDelete((uri) => schedule(uri, true, `xml`));
    javaWatcher.onDidCreate((uri) => schedule(uri, false, `java`));
    javaWatcher.onDidChange((uri) => schedule(uri, false, `java`));
    javaWatcher.onDidDelete((uri) => schedule(uri, true, `java`));
    return vscode.Disposable.from(xmlWatcher, javaWatcher);
  };

  // 1-16. 정리
  const dispose = (): void => {
    for (const timer of pendingTimers.values()) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
    for (const item of watchers) {
      item.dispose();
    }
    watchers = [];
    xmlIndex.clear();
    namespaceIndex.clear();
    javaIndex.clear();
    javaPathIndex.clear();
  };

  // 99. return -----------------------------------------------------------------------------
  return { scan, syncDoc, getXmlByPath, findXmlByNamespace, findXmlBySimpleName, findStatementByNamespace, findJavaByNamespace, findJavaBySimpleName, getJavaMapper, watch, dispose };
};
