// extension.ts

import { MybatisCommand } from "@exportCommands";
import { vscode } from "@exportLibs";
import { MapperLanguageProvider, MapperLensProvider, SqlDecorationProvider } from "@exportProviders";
import { initLogger, logger, notify } from "@exportScripts";
import { MapperIndexService, SqlLogService } from "@exportServices";
import type { MapperIndexServiceType, MapperLensProviderType, SqlDecoProviderType } from "@exportTypes";

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
  const decoProvider = SqlDecorationProvider(indexService);
  const commandManager = MybatisCommand(indexService, logService, lensProvider, decoProvider);

  const commands = commandManager.registerCommands();
  const providers = [
    vscode.languages.registerCodeLensProvider({ "language": `java` }, lensProvider.javaLens),
    vscode.languages.registerCodeLensProvider({ "language": `xml` }, lensProvider.xmlLens),
    vscode.languages.registerDefinitionProvider({ "language": `java` }, languageProvider.definitionProvider),
    vscode.languages.registerDefinitionProvider({ "language": `xml` }, languageProvider.definitionProvider),
    vscode.languages.registerHoverProvider({ "language": `java` }, languageProvider.hoverProvider),
    vscode.languages.registerHoverProvider({ "language": `xml` }, languageProvider.hoverProvider),
    vscode.languages.registerCompletionItemProvider({ "language": `xml` }, languageProvider.completionProvider, `"`, `'`),
    vscode.languages.registerDocumentSymbolProvider({ "language": `xml` }, languageProvider.symbolProvider),
  ];
  const watcher = indexService.watch(() => {
    lensProvider.refresh();
    decoProvider.apply();
  });
  const listeners = setupListeners(indexService, lensProvider, decoProvider);

  indexService.scan().then((count) => {
    logger(`info`, `activate - ${count} XML mappers indexed`);
    lensProvider.refresh();
    decoProvider.apply();
  });

  context.subscriptions.push(...commands, ...providers, watcher, ...listeners, {
    dispose: () => {
      indexService.dispose();
      lensProvider.dispose();
      decoProvider.dispose();
    },
  });
};

// 1-3. 추가 리스너 설정
const setupListeners = (indexService: MapperIndexServiceType, lensProvider: MapperLensProviderType, decoProvider: SqlDecoProviderType): vscode.Disposable[] => {
  const listeners: vscode.Disposable[] = [];
  let decorationTimer: NodeJS.Timeout | null = null;

  const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    editor && decoProvider.apply(editor);
  });

  const documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId !== `xml` && e.document.languageId !== `sql`) {
      return;
    }
    decorationTimer && clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
      decoProvider.apply();
      decorationTimer = null;
    }, 300);
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
          decoProvider.apply();
        }) : decoProvider.apply();
    lensProvider.refresh();
  });

  const timerCleanup: vscode.Disposable = {
    dispose: () => {
      decorationTimer && clearTimeout(decorationTimer);
      decorationTimer = null;
    },
  };

  listeners.push(editorListener, documentListener, configListener, timerCleanup);
  return listeners;
};
