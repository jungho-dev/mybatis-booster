// extension.ts

import { MybatisCommand } from "@exportCommands";
import { vscode } from "@exportLibs";
import { MapperDiagnosticProvider, MapperLanguageProvider, MapperLensProvider, SqlDecorationProvider } from "@exportProviders";
import { initLogger, logger, notify } from "@exportScripts";
import { MapperIndexService, SqlLogService } from "@exportServices";
import type { MapperDiagnosticProviderType, MapperIndexServiceType, MapperLensProviderType, SqlDecoProviderType } from "@exportTypes";

const CHANGE_DEBOUNCE_MS = 300;

// 1-1. deactivate
export const deactivate = () => {};

// 1-2. activate
export const activate = (context: vscode.ExtensionContext) => {

  // 0. Initialize Logger ------------------------------------------------------------------------
  initLogger();
  logger(`info`, `Mybatis is now active!`);

  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    notify(`warn`, `activate - requires an open workspace to function properly.`);
    logger(`debug`, `activate - no workspace`);
    return;
  }

  const indexService = MapperIndexService();
  const logService = SqlLogService();
  const lensProvider = MapperLensProvider(indexService);
  const languageProvider = MapperLanguageProvider(indexService);
  const diagnosticProvider = MapperDiagnosticProvider(indexService);
  const decoProvider = SqlDecorationProvider(indexService);
  const commandManager = MybatisCommand(indexService, logService, lensProvider, diagnosticProvider, decoProvider);

  const commands = commandManager.registerCommands();
  const providers = [
    vscode.languages.registerCodeLensProvider({ "language": `java` }, lensProvider.javaLens),
    vscode.languages.registerCodeLensProvider({ "language": `xml` }, lensProvider.xmlLens),
    vscode.languages.registerDefinitionProvider({ "language": `java` }, languageProvider.definitionProvider),
    vscode.languages.registerDefinitionProvider({ "language": `xml` }, languageProvider.definitionProvider),
    vscode.languages.registerHoverProvider({ "language": `java` }, languageProvider.hoverProvider),
    vscode.languages.registerHoverProvider({ "language": `xml` }, languageProvider.hoverProvider),
    vscode.languages.registerCompletionItemProvider({ "language": `xml` }, languageProvider.completionProvider, `"`, `'`, `{`),
    vscode.languages.registerDocumentSymbolProvider({ "language": `xml` }, languageProvider.symbolProvider),
  ];
  const watcher = indexService.watch(() => {
    lensProvider.refresh();
    diagnosticProvider.applyOpenDocuments();
    decoProvider.applyVisible();
  });
  const listeners = setupListeners(indexService, lensProvider, diagnosticProvider, decoProvider);

  indexService.scan().then((count) => {
    logger(`info`, `activate - ${count} XML mappers indexed`);
    lensProvider.refresh();
    diagnosticProvider.applyOpenDocuments();
    decoProvider.applyVisible();
  }).catch((error) => {
    logger(`error`, `activate - initial scan failed: ${error}`);
  });

  context.subscriptions.push(...commands, ...providers, watcher, ...listeners, {
    dispose: () => {
      indexService.dispose();
      lensProvider.dispose();
      diagnosticProvider.dispose();
      decoProvider.dispose();
    },
  });
};

// 1-3. 추가 리스너 설정
const setupListeners = (indexService: MapperIndexServiceType, lensProvider: MapperLensProviderType, diagnosticProvider: MapperDiagnosticProviderType, decoProvider: SqlDecoProviderType): vscode.Disposable[] => {
  const listeners: vscode.Disposable[] = [];
  let decorationTimer: NodeJS.Timeout | null = null;
  let javaSyncTimer: NodeJS.Timeout | null = null;

  const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) {
      return;
    }
    diagnosticProvider.apply(editor.document);
    decoProvider.apply(editor);
  });

  const documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId === `java`) {
      javaSyncTimer && clearTimeout(javaSyncTimer);
      javaSyncTimer = setTimeout(() => {
        javaSyncTimer = null;
        indexService.getJavaMapper(e.document);
        lensProvider.refresh();
        diagnosticProvider.applyOpenDocuments();
        decoProvider.apply();
      }, CHANGE_DEBOUNCE_MS);
      return;
    }
    if (e.document.languageId !== `xml` && e.document.languageId !== `sql`) {
      return;
    }
    decorationTimer && clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
      decorationTimer = null;
      // XML 변경은 열린 Java mapper의 missing-statement 진단에도 영향하므로 양방향 갱신
      e.document.languageId === `xml` && diagnosticProvider.applyOpenDocuments();
      decoProvider.apply();
    }, CHANGE_DEBOUNCE_MS);
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration(`Mybatis`)) {
      return;
    }
    logger(`debug`, `activate - configuration changed`);
    if (
      e.affectsConfiguration(`Mybatis.sqlKeywordColor`) ||
      e.affectsConfiguration(`Mybatis.sqlDangerColor`) ||
      e.affectsConfiguration(`Mybatis.sqlStringColor`) ||
      e.affectsConfiguration(`Mybatis.sqlNumberColor`) ||
      e.affectsConfiguration(`Mybatis.sqlCommentColor`) ||
      e.affectsConfiguration(`Mybatis.sqlInvalidCommentColor`)
    ) {
      decoProvider.rebuild();
    }
    e.affectsConfiguration(`Mybatis.searchExclude`) ? indexService.scan().then(() => {
          lensProvider.refresh();
          diagnosticProvider.applyOpenDocuments();
          decoProvider.applyVisible();
        }).catch((error) => {
          logger(`error`, `activate - rescan failed: ${error}`);
        }) : (() => {
          diagnosticProvider.applyOpenDocuments();
          decoProvider.applyVisible();
        })();
    lensProvider.refresh();
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    (document.languageId === `xml` || document.languageId === `java`) && diagnosticProvider.clear(document);
  });

  const timerCleanup: vscode.Disposable = {
    dispose: () => {
      decorationTimer && clearTimeout(decorationTimer);
      javaSyncTimer && clearTimeout(javaSyncTimer);
      decorationTimer = null;
      javaSyncTimer = null;
    },
  };

  listeners.push(editorListener, documentListener, closeListener, configListener, timerCleanup);
  return listeners;
};
