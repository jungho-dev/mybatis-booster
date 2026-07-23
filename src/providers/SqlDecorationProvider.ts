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
  editor: vscode.TextEditor;
  maxDocumentLength: number;
  uri: string;
  version: number;
}

interface ExclusionRange {
  end: number;
  start: number;
}

const XML_COMMENT_PATTERN = `<!--[\\s\\S]*?-->`;
const SQL_COMMENT_PATTERN = `--[^\\r\\n]*|/\\*[\\s\\S]*?\\*/`;
const SQL_STRING_PATTERN = `'(?:''|[^'])*'`;
const SQL_NUMBER_PATTERN = `\\b(?:0x[0-9A-Fa-f]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b`;
const XML_MARKUP_PATTERN = `<[\\s\\S]*?>|#\\{[^}]*\\}|\\$\\{[^}]*\\}`;

// ------------------------------------------------------------------------------
// 1. SQL/XML syntax 데코레이션
// ------------------------------------------------------------------------------
export const SqlDecorationProvider = (indexService: MapperIndexServiceType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  let commonGroups: DecorationGroup[] = [];
  let sqlGroups: DecorationGroup[] = [];
  let xmlGroups: DecorationGroup[] = [];
  let cache: DecorationCache | undefined;

  // 1-1. 설정 조회
  const getConfig = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(`Mybatis`);

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
        "decorationType": createType(config.get<string>(`sqlKeywordColor`, `#24BFA5`), true),
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
    cache = undefined;
  };

  // 1-5. 문서 길이 계산
  const getDocumentLength = (document: vscode.TextDocument): number => {
    const lastLine = document.lineAt(document.lineCount - 1);
    return document.offsetAt(lastLine.range.end);
  };

  // 1-6. 제외 범위 병합
  const mergeRanges = (ranges: ExclusionRange[]): ExclusionRange[] => {
    ranges.sort((a, b) => a.start - b.start);
    const merged: ExclusionRange[] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (!last) {
        merged.push(range);
      }
      else if (range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
      }
      else {
        merged.push(range);
      }
    }
    return merged;
  };

  // 1-7. 정규식 매칭 범위 수집
  const collectRanges = (text: string, pattern: string): ExclusionRange[] => {
    const ranges: ExclusionRange[] = [];
    const regex = new RegExp(pattern, `g`);
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      ranges.push({ "end": match.index + match[0].length, "start": match.index });
    }
    return ranges;
  };

  // 1-8. 키워드/리터럴 제외 범위 생성
  const buildExclusions = (text: string, language: string): ExclusionRange[] => {
    const ranges = [
      ...collectRanges(text, SQL_COMMENT_PATTERN),
      ...collectRanges(text, XML_COMMENT_PATTERN),
    ];
    if (language === `xml`) {
      ranges.push(...collectRanges(text, XML_MARKUP_PATTERN));
    }
    return mergeRanges(ranges);
  };

  // 1-9. 정상 주석 오탐 제외 범위 생성
  const buildNativeCommentExclusions = (text: string, language: string): ExclusionRange[] => {
    const ranges = [...collectRanges(text, SQL_STRING_PATTERN)];
    if (language === `sql`) {
      ranges.push(...collectRanges(text, XML_COMMENT_PATTERN));
    }
    return mergeRanges(ranges);
  };

  // 1-10. 잘못된 주석 오탐 제외 범위 생성
  const buildInvalidCommentExclusions = (text: string, language: string): ExclusionRange[] => {
    const ranges = [...collectRanges(text, SQL_STRING_PATTERN)];
    if (language === `xml`) {
      ranges.push(...collectRanges(text, XML_COMMENT_PATTERN));
      ranges.push(...collectRanges(text, XML_MARKUP_PATTERN));
    }
    else {
      ranges.push(...collectRanges(text, SQL_COMMENT_PATTERN));
    }
    return mergeRanges(ranges);
  };

  // 1-11. 오프셋 제외 여부
  const isExcluded = (ranges: ExclusionRange[], index: number): boolean => {
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

  // 1-12. 활성 에디터 데코레이션 제거
  const clear = (editor: vscode.TextEditor): void => {
    for (const group of [...commonGroups, ...sqlGroups, ...xmlGroups]) {
      editor.setDecorations(group.decorationType, []);
    }
  };

  // 1-13. 활성 에디터에 SQL 문법 데코레이션 적용
  const apply = (editor?: vscode.TextEditor): void => {
    const target = editor ?? vscode.window.activeTextEditor;
    if (!target || (target.document.languageId !== `xml` && target.document.languageId !== `sql`)) {
      return;
    }
    const document = target.document;
    const config = getConfig();
    if (!config.get<boolean>(`sqlHighlightEnabled`, true)) {
      clear(target);
      cache = undefined;
      return;
    }
    if (document.languageId === `xml` && !indexService.syncDoc(document)) {
      clear(target);
      cache = undefined;
      return;
    }
    const maxDocLength = Math.max(0, config.get<number>(`maxDocumentLength`, 300_000));
    const docLength = getDocumentLength(document);
    const uri = document.uri.toString();
    const cacheHit = cache?.editor === target && cache.uri === uri && cache.version === document.version && cache.maxDocumentLength === maxDocLength;
    if (cacheHit) {
      return;
    }
    if (maxDocLength > 0 && docLength > maxDocLength) {
      clear(target);
      cache = { "editor": target, "maxDocumentLength": maxDocLength, uri, "version": document.version };
      return;
    }
    const text = document.getText();
    const standardExclusions = buildExclusions(text, document.languageId);
    const nativeExclusions = buildNativeCommentExclusions(text, document.languageId);
    const invalidExclusions = buildInvalidCommentExclusions(text, document.languageId);
    const languageGroups = document.languageId === `xml` ? xmlGroups : sqlGroups;
    for (const group of [...languageGroups, ...commonGroups]) {
      const ranges: vscode.Range[] = [];
      const exclusions = group.exclusionKind === `invalidComment`
        ? invalidExclusions
        : group.exclusionKind === `nativeComment`
          ? nativeExclusions
          : standardExclusions;
      group.pattern.lastIndex = 0;
      for (let match = group.pattern.exec(text); match; match = group.pattern.exec(text)) {
        if (group.useExclusions && isExcluded(exclusions, match.index)) {
          continue;
        }
        ranges.push(new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)));
      }
      target.setDecorations(group.decorationType, ranges);
    }
    cache = { "editor": target, "maxDocumentLength": maxDocLength, uri, "version": document.version };
    logger(`debug`, `decorate - ${document.languageId} syntax in ${document.uri.fsPath}`);
  };

  // 1-14. 정리
  const dispose = (): void => {
    disposeGroups();
    cache = undefined;
  };

  rebuild();

  // 99. return -----------------------------------------------------------------------------
  return { apply, rebuild, dispose };
};
