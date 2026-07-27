# Mybatis-Booster Architecture

## Runtime Surface

```text
package.json activationEvents (onLanguage:java, onLanguage:xml)
  -> src/extension.ts activate(context)
  -> MapperIndexService()
  -> MapperLensProvider(indexService) + MapperLanguageProvider(indexService) + SqlDecorationProvider(indexService)
  -> MybatisCommand(indexService, sqlLogService, lensProvider, decorationProvider)
```

`src/extension.ts` owns activation, output logging setup, provider registration, the XML file
watcher, configuration refresh, and disposable cleanup. Activation requires an open workspace.

## Source Map

```text
src/
|-- commands/
|   `-- MybatisCommand.ts           command registration, goto/create/format-log actions
|-- providers/
|   |-- MapperLanguageProvider.ts   definition, hover, XML completion, and XML symbols
|   |-- MapperLensProvider.ts       Java and XML CodeLens builders
|   `-- SqlDecorationProvider.ts    SQL syntax decoration for XML mapper and SQL editors
|-- services/
|   |-- MapperIndexService.ts       XML mapper index, Java parse cache, file watcher
|   `-- SqlLogService.ts            Preparing/Parameters log parsing and SQL formatting
|-- models/
|   `-- MapperModel.ts              regex-based XML and Java mapper parsers
|-- assets/
|   |-- scripts/                    logger, notify, LRU cache, SQL keyword list
|   `-- types/                      ambient path aliases
`-- exports/                        barrel exports for local aliases
```

Generated files live in `out/` and are rebuilt by the VSIX tool path. They are not source of truth.

## Mapper Matching

```text
XML: <mapper namespace="com.foo.BarMapper">
  -> index key: file fsPath, value: namespace + statement ids/lines
Java: package com.foo; interface BarMapper
  -> namespace = packageName + "." + interfaceName
  -> workspace.findFiles("**/com/foo/BarMapper.java") resolves the Java side
```

Statement elements (`select`, `insert`, `update`, `delete`) map to Java methods by `id` equality.
Missing counterparts surface as Create CodeLens actions that insert stubs before `</mapper>` or the
final closing brace.
Definition, completion, and outline providers use the same mapper index, so they stay aligned with
CodeLens and file watcher refreshes.

## Index And Watcher Model

`MapperIndexService` scans `**/*.xml` minus `Mybatis-Booster.searchExclude` globs in batches of `50`,
parsing only files whose text contains a `<mapper namespace>` root. A single `FileSystemWatcher`
re-indexes changed files with a `200ms` per-path debounce. Open XML documents re-parse through
`syncDoc` so dirty editors stay accurate. Java parses cache per document version in an LRU of
`100` entries.

## Log Conversion

```text
"Preparing: SELECT * FROM user WHERE id = ?"
"Parameters: 7(Integer), lee(String)"
  -> ? placeholders filled in order
  -> numeric wrapper types stay raw, other values quoted, null becomes NULL
  -> result opens as an untitled SQL document
```

## Responsiveness Rules

- `Mybatis-Booster.logLevel=off` suppresses console and output-channel formatting work.
- XML scans run in batches of `50` files.
- Watcher re-index and editor decoration refresh are debounced (`200ms` / `300ms`).
- Decoration masks XML markup and comments once per apply instead of parsing per keyword.

## Build And Validation

```powershell
bunx tsc --noEmit
bunx biome check src
bun run tools
```

For VSIX packaging, select `tools --vsce` from the `bun run tools` menu. That path bundles the
extension with esbuild, copies runtime dependencies, and runs `vsce package --no-dependencies`.
