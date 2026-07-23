// services/MapperIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { parseJavaMapper, parseXmlMapper } from "@exportModels";
import { LRUCache, logger } from "@exportScripts";
import type { JavaMapperType, XmlMapperType } from "@exportTypes";

const SCAN_BATCH = 50;
const SYNC_DEBOUNCE_MS = 200;

export const MapperIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const xmlIndex = new Map<string, XmlMapperType>();
  const javaCache = new LRUCache<string, JavaMapperType | null>(100);
  const decoder = new TextDecoder(`utf-8`);
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  let watcher: vscode.FileSystemWatcher | null = null;

  // 1-1. 스캔 제외 글롭 생성
  const getExcludeGlob = (): string | undefined => {
    const list = vscode.workspace.getConfiguration(`Mybatis`).get<string[]>(`searchExclude`, []);
    return list.length > 0 ? `{${list.join(`,`)}}` : undefined;
  };

  // 1-2. 단일 XML 파일 인덱싱
  const indexFile = async (uri: vscode.Uri): Promise<void> => {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const mapper = parseXmlMapper(uri.fsPath, decoder.decode(bytes));
      mapper ? xmlIndex.set(uri.fsPath, mapper) : xmlIndex.delete(uri.fsPath);
    }
    catch {
      xmlIndex.delete(uri.fsPath);
    }
  };

  // 1-3. 워크스페이스 전체 스캔
  const scan = async (): Promise<number> => {
    xmlIndex.clear();
    const uris = await vscode.workspace.findFiles(`**/*.xml`, getExcludeGlob());
    for (let i = 0; i < uris.length; i += SCAN_BATCH) {
      await Promise.all(uris.slice(i, i + SCAN_BATCH).map((uri) => indexFile(uri)));
    }
    logger(`debug`, `scan - ${uris.length} xml files checked, ${xmlIndex.size} mappers indexed`);
    return xmlIndex.size;
  };

  // 1-4. 열린 문서 기준 동기 파싱 (dirty 문서 포함 최신 상태 반영)
  const syncDoc = (document: vscode.TextDocument): XmlMapperType | null => {
    const mapper = parseXmlMapper(document.uri.fsPath, document.getText());
    mapper ? xmlIndex.set(document.uri.fsPath, mapper) : xmlIndex.delete(document.uri.fsPath);
    return mapper;
  };

  // 1-5. 경로/네임스페이스 조회
  const getXmlByPath = (fsPath: string): XmlMapperType | undefined => xmlIndex.get(fsPath);
  const findXmlByNamespace = (namespace: string): XmlMapperType[] => [...xmlIndex.values()].filter((m) => m.namespace === namespace);

  // 1-6. 네임스페이스로 Java 파일 검색
  const findJavaUri = async (namespace: string): Promise<vscode.Uri | undefined> => {
    const relative = namespace.replace(/\./g, `/`);
    const uris = await vscode.workspace.findFiles(`**/${relative}.java`, getExcludeGlob(), 1);
    return uris[0];
  };

  // 1-7. Java mapper 파싱 (문서 버전 키 캐시)
  const getJavaMapper = (document: vscode.TextDocument): JavaMapperType | null => {
    const key = `${document.uri.fsPath}@${document.version}`;
    const cached = javaCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const parsed = parseJavaMapper(document.getText());
    javaCache.set(key, parsed);
    return parsed;
  };

  // 1-8. XML 변경 감시 (경로별 debounce)
  const watch = (onUpdate: () => void): vscode.Disposable => {
    watcher = vscode.workspace.createFileSystemWatcher(`**/*.xml`);
    const schedule = (uri: vscode.Uri, removed: boolean): void => {
      const prev = pendingTimers.get(uri.fsPath);
      prev && clearTimeout(prev);
      pendingTimers.set(uri.fsPath, setTimeout(() => {
        pendingTimers.delete(uri.fsPath);
        removed ? (() => {
            xmlIndex.delete(uri.fsPath);
            onUpdate();
          })() : indexFile(uri).then(onUpdate);
      }, SYNC_DEBOUNCE_MS));
    };
    watcher.onDidCreate((uri) => schedule(uri, false));
    watcher.onDidChange((uri) => schedule(uri, false));
    watcher.onDidDelete((uri) => schedule(uri, true));
    return watcher;
  };

  // 1-9. 정리
  const dispose = (): void => {
    for (const timer of pendingTimers.values()) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
    watcher?.dispose();
    watcher = null;
    xmlIndex.clear();
    javaCache.clear();
  };

  // 99. return -----------------------------------------------------------------------------
  return { scan, syncDoc, getXmlByPath, findXmlByNamespace, findJavaUri, getJavaMapper, watch, dispose };
};
