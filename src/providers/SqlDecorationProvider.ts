// providers/SqlDecorationProvider.ts

import { vscode } from "@exportLibs";
import { getDangerRegex, getKeywordRegex, logger } from "@exportScripts";
import type { MapperIndexServiceType } from "@exportTypes";

interface DecorationGroup {
  decorationType: vscode.TextEditorDecorationType;
  exclusionKind?: `standard` | `nativeComment` | `invalidComment`;
  pattern: RegExp;
  useExclusions?: boolean;
}

interface DecorationCache {
  epoch: number;
  maxDocumentLength: number;
  uri: string;
  version: number;
}

interface ExclusionRange {
  end: number;
  start: number;
}

interface ExclusionSets {
  invalidComment: ExclusionRange[];
  nativeComment: ExclusionRange[];
  standard: ExclusionRange[];
}

const XML_COMMENT_PATTERN = `<!--[\\s\\S]*?-->`;
const SQL_COMMENT_PATTERN = `--[^\\r\\n]*|/\\*[\\s\\S]*?\\*/`;
const SQL_STRING_PATTERN = `'(?:''|[^'])*'`;
const SQL_NUMBER_PATTERN = `\\b(?:0x[0-9A-Fa-f]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b`;
const XML_CDATA_OPEN = `<![CDATA[`;
const XML_CDATA_CLOSE = `]]>`;
// 미종료 CDATA(편집 중)도 여는 구분자만 인식하도록 두 번째 분기를 둠
const XML_CDATA_PATTERN = `<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<!\\[CDATA\\[`;
// 속성값 안의 > 를 태그 종료로 오인하지 않도록 따옴표 구간을 건너뜀
const XML_TAG_PATTERN = `<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>`;
// 분기 순서가 곧 우선순위: 주석과 CDATA를 태그보다 먼저 확정해야 경계가 밀리지 않음
const XML_MARKUP_PATTERN = `${XML_COMMENT_PATTERN}|${XML_CDATA_PATTERN}|${XML_TAG_PATTERN}|#\\{[^}]*\\}|\\$\\{[^}]*\\}`;
const XML_COMMENT_REGEX = new RegExp(XML_COMMENT_PATTERN, `g`);
const SQL_COMMENT_REGEX = new RegExp(SQL_COMMENT_PATTERN, `g`);
const SQL_STRING_REGEX = new RegExp(SQL_STRING_PATTERN, `g`);
const XML_MARKUP_REGEX = new RegExp(XML_MARKUP_PATTERN, `g`);
const JAVA_SQL_ANNOTATION_PATTERN = `@(?:Select|Insert|Update|Delete)\\s*\\(`;
const JAVA_STRING_PATTERN = `"(?:\\\\.|[^"\\\\])*"`;

// ------------------------------------------------------------------------------
// 1. SQL/XML syntax 데코레이션
// ------------------------------------------------------------------------------
export const SqlDecorationProvider = (indexService: MapperIndexServiceType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  let commonGroups: DecorationGroup[] = [];
  let sqlGroups: DecorationGroup[] = [];
  let xmlGroups: DecorationGroup[] = [];
  let cacheEpoch = 0;
  const editorCache = new WeakMap<vscode.TextEditor, DecorationCache>();

  // 1-1. 설정 조회
  const getConfig = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(`Mybatis-Booster`);

  // 1-2. 색상 데코레이션 생성
  const createType = (color: string | vscode.ThemeColor, bold = false): vscode.TextEditorDecorationType => vscode.window.createTextEditorDecorationType({
    "color": color,
    "fontWeight": bold ? `bold` : `normal`,
  });

  // 1-3. 모든 데코레이션 타입 정리
  const disposeGroups = (): void => {
    for (const group of [...commonGroups, ...sqlGroups, ...xmlGroups]) {
      group.decorationType.dispose();
    }
    commonGroups = [];
    sqlGroups = [];
    xmlGroups = [];
  };

  // 1-4. 데코레이션 타입 생성 (색상 설정 변경 시 재생성)
  const rebuild = (): void => {
    disposeGroups();
    const config = getConfig();
    commonGroups = [
      {
        "decorationType": createType(config.get<string>(`sqlDangerColor`, `#F44747`), true),
        "exclusionKind": `standard`,
        "pattern": getDangerRegex(),
        "useExclusions": true,
      },
      {
        "decorationType": createType(config.get<string>(`sqlKeywordColor`, `#c586c0`), true),
        "exclusionKind": `standard`,
        "pattern": getKeywordRegex(),
        "useExclusions": true,
      },
      {
        "decorationType": createType(config.get<string>(`sqlStringColor`, `#f4d4ae`)),
        "exclusionKind": `standard`,
        "pattern": new RegExp(SQL_STRING_PATTERN, `g`),
        "useExclusions": true,
      },
      {
        "decorationType": createType(config.get<string>(`sqlNumberColor`, `#00FF00`)),
        "exclusionKind": `standard`,
        "pattern": new RegExp(SQL_NUMBER_PATTERN, `g`),
        "useExclusions": true,
      },
    ];
    sqlGroups = [
      {
        "decorationType": createType(config.get<string>(`sqlCommentColor`, `#ffff00`)),
        "exclusionKind": `nativeComment`,
        "pattern": new RegExp(SQL_COMMENT_PATTERN, `g`),
        "useExclusions": true,
      },
      {
        "decorationType": createType(config.get<string>(`sqlInvalidCommentColor`, `#5d9b5d`)),
        "exclusionKind": `invalidComment`,
        "pattern": new RegExp(XML_COMMENT_PATTERN, `g`),
        "useExclusions": true,
      },
    ];
    xmlGroups = [
      {
        "decorationType": createType(config.get<string>(`sqlCommentColor`, `#ffff00`)),
        "exclusionKind": `nativeComment`,
        "pattern": new RegExp(XML_COMMENT_PATTERN, `g`),
        "useExclusions": true,
      },
      {
        "decorationType": createType(config.get<string>(`sqlInvalidCommentColor`, `#5d9b5d`)),
        "exclusionKind": `invalidComment`,
        "pattern": new RegExp(SQL_COMMENT_PATTERN, `g`),
        "useExclusions": true,
      },
    ];
    cacheEpoch += 1;
  };

  // 1-5. 문서 길이 계산
  const getDocumentLength = (document: vscode.TextDocument): number => {
    const lastLine = document.lineAt(document.lineCount - 1);
    return document.offsetAt(lastLine.range.end);
  };

  // 1-6. 제외 범위 병합 (입력 범위 객체는 세트 간 공유되므로 변형 금지)
  const mergeRanges = (ranges: ExclusionRange[]): ExclusionRange[] => {
    ranges.sort((a, b) => a.start - b.start);
    const merged: ExclusionRange[] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
      }
      else {
        merged.push({ "end": range.end, "start": range.start });
      }
    }
    return merged;
  };

  // 1-7. 정규식 매칭 범위 수집
  const collectRanges = (text: string, regex: RegExp): ExclusionRange[] => {
    const ranges: ExclusionRange[] = [];
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      ranges.push({ "end": match.index + match[0].length, "start": match.index });
    }
    return ranges;
  };

  // 1-7-1. XML 마크업 제외 범위 수집 (CDATA는 구분자만 제외해 내부 SQL을 하이라이트 대상으로 남김)
  const collectMarkupRanges = (text: string): ExclusionRange[] => {
    const ranges: ExclusionRange[] = [];
    XML_MARKUP_REGEX.lastIndex = 0;
    for (let match = XML_MARKUP_REGEX.exec(text); match; match = XML_MARKUP_REGEX.exec(text)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!match[0].startsWith(XML_CDATA_OPEN)) {
        ranges.push({ end, start });
        continue;
      }
      ranges.push({ "end": start + XML_CDATA_OPEN.length, start });
      match[0].endsWith(XML_CDATA_CLOSE) && ranges.push({ end, "start": end - XML_CDATA_CLOSE.length });
    }
    return ranges;
  };

  // 1-8. 그룹별 제외 범위 생성 (기본 패턴을 문서당 1회씩만 스캔 후 조합)
  const buildExclusionSets = (text: string, language: string): ExclusionSets => {
    const sqlComments = collectRanges(text, SQL_COMMENT_REGEX);
    const xmlComments = collectRanges(text, XML_COMMENT_REGEX);
    const sqlStrings = collectRanges(text, SQL_STRING_REGEX);
    const xmlMarkups = language === `xml` ? collectMarkupRanges(text) : [];
    return {
      "standard": mergeRanges([...sqlComments, ...xmlComments, ...xmlMarkups]),
      "nativeComment": mergeRanges(language === `sql` ? [...sqlStrings, ...xmlComments] : [...sqlStrings]),
      "invalidComment": mergeRanges(language === `xml` ? [...sqlStrings, ...xmlComments, ...xmlMarkups] : [...sqlStrings, ...sqlComments]),
    };
  };

  // 1-9. Java SQL 어노테이션(@Select 등) 내부 문자열 리터럴 범위 수집
  const collectJavaSqlRanges = (text: string): ExclusionRange[] => {
    const ranges: ExclusionRange[] = [];
    const annotationRegex = new RegExp(JAVA_SQL_ANNOTATION_PATTERN, `g`);
    const stringRegex = new RegExp(JAVA_STRING_PATTERN, `g`);
    for (let match = annotationRegex.exec(text); match; match = annotationRegex.exec(text)) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let close = open;
      for (let i = open; i < text.length; i++) {
        const char = text[i];
        if (char === `"`) {
          // 문자열 내부의 괄호는 깊이 계산에서 제외
          i += 1;
          while (i < text.length && (text[i] !== `"` || text[i - 1] === `\\`)) {
            i += 1;
          }
          continue;
        }
        if (char === `(`) {
          depth += 1;
        }
        else if (char === `)`) {
          depth -= 1;
        }
        if (depth === 0) {
          close = i;
          break;
        }
      }
      stringRegex.lastIndex = open;
      for (let str = stringRegex.exec(text); str && str.index < close; str = stringRegex.exec(text)) {
        ranges.push({ "end": str.index + str[0].length - 1, "start": str.index + 1 });
      }
      annotationRegex.lastIndex = Math.max(annotationRegex.lastIndex, close);
    }
    return mergeRanges(ranges);
  };

  // 1-10. 오프셋 범위 포함 여부 (XML/SQL에서는 제외, Java에서는 포함 판정에 사용)
  const inRanges = (ranges: ExclusionRange[], index: number): boolean => {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const range = ranges[mid];
      if (index < range.start) {
        high = mid - 1;
      }
      else if (index >= range.end) {
        low = mid + 1;
      }
      else {
        return true;
      }
    }
    return false;
  };

  // 1-11. 활성 에디터 데코레이션 제거
  const clear = (editor: vscode.TextEditor): void => {
    for (const group of [...commonGroups, ...sqlGroups, ...xmlGroups]) {
      editor.setDecorations(group.decorationType, []);
    }
  };

  // 1-12. 활성 에디터에 SQL 문법 데코레이션 적용 (xml/sql 전체, java는 SQL 어노테이션 문자열만)
  const apply = (editor?: vscode.TextEditor): void => {
    const target = editor ?? vscode.window.activeTextEditor;
    const languageId = target?.document.languageId;
    if (!target || (languageId !== `xml` && languageId !== `sql` && languageId !== `java`)) {
      return;
    }
    const document = target.document;
    const config = getConfig();
    if (!config.get<boolean>(`sqlHighlightEnabled`, true)) {
      clear(target);
      editorCache.delete(target);
      return;
    }
    if (document.languageId === `xml` && !indexService.syncDoc(document)) {
      clear(target);
      editorCache.delete(target);
      return;
    }
    const maxDocLength = Math.max(0, config.get<number>(`maxDocumentLength`, 300_000));
    const docLength = getDocumentLength(document);
    const uri = document.uri.toString();
    const cached = editorCache.get(target);
    const cacheHit = cached?.epoch === cacheEpoch && cached.uri === uri && cached.version === document.version && cached.maxDocumentLength === maxDocLength;
    if (cacheHit) {
      return;
    }
    if (maxDocLength > 0 && docLength > maxDocLength) {
      clear(target);
      editorCache.set(target, { "epoch": cacheEpoch, "maxDocumentLength": maxDocLength, uri, "version": document.version });
      return;
    }
    const text = document.getText();
    if (document.languageId === `java`) {
      const inclusions = collectJavaSqlRanges(text);
      if (inclusions.length === 0) {
        clear(target);
        editorCache.set(target, { "epoch": cacheEpoch, "maxDocumentLength": maxDocLength, uri, "version": document.version });
        return;
      }
      for (const group of [...sqlGroups, ...xmlGroups]) {
        target.setDecorations(group.decorationType, []);
      }
      for (const group of commonGroups) {
        const ranges: vscode.Range[] = [];
        group.pattern.lastIndex = 0;
        for (let match = group.pattern.exec(text); match; match = group.pattern.exec(text)) {
          if (!inRanges(inclusions, match.index)) {
            continue;
          }
          ranges.push(new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)));
        }
        target.setDecorations(group.decorationType, ranges);
      }
      editorCache.set(target, { "epoch": cacheEpoch, "maxDocumentLength": maxDocLength, uri, "version": document.version });
      logger(`debug`, `decorate - java annotation sql in ${document.uri.fsPath}`);
      return;
    }
    const exclusionSets = buildExclusionSets(text, document.languageId);
    const languageGroups = document.languageId === `xml` ? xmlGroups : sqlGroups;
    for (const group of [...languageGroups, ...commonGroups]) {
      const ranges: vscode.Range[] = [];
      const exclusions = exclusionSets[group.exclusionKind ?? `standard`];
      group.pattern.lastIndex = 0;
      for (let match = group.pattern.exec(text); match; match = group.pattern.exec(text)) {
        if (group.useExclusions && inRanges(exclusions, match.index)) {
          continue;
        }
        ranges.push(new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)));
      }
      target.setDecorations(group.decorationType, ranges);
    }
    editorCache.set(target, { "epoch": cacheEpoch, "maxDocumentLength": maxDocLength, uri, "version": document.version });
    logger(`debug`, `decorate - ${document.languageId} syntax in ${document.uri.fsPath}`);
  };

  // 1-12-1. 보이는 모든 에디터에 적용 (설정 변경/재스캔/워처 갱신용 — 분할 뷰 유실 방지)
  const applyVisible = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      apply(editor);
    }
  };

  // 1-13. 정리
  const dispose = (): void => {
    disposeGroups();
    cacheEpoch += 1;
  };

  rebuild();

  // 99. return -----------------------------------------------------------------------------
  return { apply, applyVisible, rebuild, dispose };
};
