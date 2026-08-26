// providers/MapperCodeActionProvider.ts

import { vscode } from "@exportLibs";
import { logger } from "@exportScripts";
import type { MapperIndexServiceType } from "@exportTypes";

const DIAGNOSTIC_SOURCE = `Mybatis`;
const NAMESPACE_VALUE_PATTERN = /namespace\s*=\s*["']([^"']*)["']/;
const CHAR_LITERAL_QUOTE_PATTERN = /'([^'])'/g;

// ------------------------------------------------------------------------------
// 1. XML/Java mapper Quick Fix
// ------------------------------------------------------------------------------
export const MapperCodeActionProvider = (indexService: MapperIndexServiceType) => {
  // 1-1. 언어 기능 활성화 여부 (진단과 동일 토글 사용)
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(`Mybatis-Booster`).get<boolean>(`languageFeaturesEnabled`, true);

  // 1-2. XML statement 생성 액션 (Java 미구현 메서드 진단 대상)
  const missingStatementActions = (document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] => {
    const javaMapper = indexService.getJavaMapper(document);
    if (!javaMapper) {
      return [];
    }
    const namespace = `${javaMapper.packageName}.${javaMapper.interfaceName}`;
    const xmlMappers = indexService.findXmlByNamespace(namespace);
    if (xmlMappers.length === 0) {
      return [];
    }
    const method = javaMapper.methods.find((item) => item.line === diagnostic.range.start.line);
    if (!method) {
      return [];
    }
    const action = new vscode.CodeAction(`Create XML statement '${method.name}'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.command = {
      "command": `Mybatis-Booster.createxmlstatement`,
      "title": `Create XML statement`,
      "arguments": [xmlMappers[0].fsPath, method.name],
    };
    return [action];
  };

  // 1-3. Java 메서드 생성 액션 (미사용 statement 진단 대상)
  const unusedStatementActions = async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic): Promise<vscode.CodeAction[]> => {
    const xmlMapper = indexService.syncDoc(document);
    if (!xmlMapper) {
      return [];
    }
    const indexed = await indexService.findJavaByNamespace(xmlMapper.namespace);
    if (!indexed) {
      return [];
    }
    const statement = xmlMapper.statements.find((item) => item.line === diagnostic.range.start.line);
    if (!statement) {
      return [];
    }
    const action = new vscode.CodeAction(`Create Java method '${statement.id}()'`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.command = {
      "command": `Mybatis-Booster.createjavamethod`,
      "title": `Create Java method`,
      "arguments": [indexed.uri.fsPath, statement.id, statement.tag],
    };
    return [action];
  };

  // 1-4. namespace 치환 액션 (동일 interface 단순명 후보로 교체)
  const namespaceMismatchActions = (document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] => {
    const xmlMapper = indexService.syncDoc(document);
    if (!xmlMapper) {
      return [];
    }
    const simpleName = xmlMapper.namespace.split(`.`).at(-1) ?? ``;
    const named = simpleName ? indexService.findJavaBySimpleName(simpleName) : [];
    const candidates = named.filter((namespace) => indexService.findXmlByNamespace(namespace).length === 0);
    if (candidates.length === 0) {
      return [];
    }
    const lineText = document.lineAt(xmlMapper.namespaceLine).text;
    const match = NAMESPACE_VALUE_PATTERN.exec(lineText);
    if (!match) {
      return [];
    }
    const valueStart = match.index + match[0].length - 1 - match[1].length;
    const range = new vscode.Range(xmlMapper.namespaceLine, valueStart, xmlMapper.namespaceLine, valueStart + match[1].length);
    return candidates.slice(0, 3).map((candidate) => {
      const action = new vscode.CodeAction(`Change namespace to '${candidate}'`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, range, candidate);
      return action;
    });
  };

  // 1-5. OGNL 단일문자 리터럴 치환 액션 (속성 구분자에 따라 " 또는 &quot; 사용)
  const ognlCharActions = (document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] => {
    const range = diagnostic.range;
    const text = document.getText(range);
    // 속성 값 바로 앞 문자가 구분자 (test="..." 이면 " 를 만나 &quot; 로 대체해야 XML 이 깨지지 않음)
    const attrQuote = range.start.character > 0 ? document.getText(new vscode.Range(range.start.line, range.start.character - 1, range.start.line, range.start.character)) : ``;
    const replaced = attrQuote === `"` ? text.replace(CHAR_LITERAL_QUOTE_PATTERN, `&quot;$1&quot;`) : text.replace(CHAR_LITERAL_QUOTE_PATTERN, `"$1"`);
    if (replaced === text) {
      return [];
    }
    const action = new vscode.CodeAction(`Convert char literal to string literal`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, range, replaced);
    return [action];
  };

  // 1-6. 진단 코드별 액션 라우팅
  const buildActions = async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic): Promise<vscode.CodeAction[]> => {
    switch (String(diagnostic.code)) {
      case `missing-mybatis-statement`:
        return missingStatementActions(document, diagnostic);
      case `unused-mybatis-statement`:
        return unusedStatementActions(document, diagnostic);
      case `mybatis-namespace-mismatch`:
        return namespaceMismatchActions(document, diagnostic);
      case `mybatis-ognl-char-literal`:
        return ognlCharActions(document, diagnostic);
      default:
        return [];
    }
  };

  // 2-1. Quick Fix 공급자
  const codeActionProvider: vscode.CodeActionProvider = {
    "provideCodeActions": async (document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> => {
      if (!isEnabled()) {
        return [];
      }
      const actions: vscode.CodeAction[] = [];
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.source !== DIAGNOSTIC_SOURCE) {
          continue;
        }
        // biome-ignore lint/performance/noAwaitInLoops: 진단당 순차 해석으로 인덱스 조회 폭주 방지
        actions.push(...(await buildActions(document, diagnostic)));
      }
      actions.length > 0 && logger(`debug`, `codeaction - ${actions.length} quick fixes in ${document.uri.fsPath}`);
      return actions;
    },
  };

  // 99. return -----------------------------------------------------------------------------
  return { codeActionProvider };
};
