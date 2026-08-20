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
  -> index key: file fsPath, value: namespace + statement ids/lines/end lines
Java: package com.foo; top-level interface BarMapper
  -> namespace = packageName + "." + interfaceName
  -> javaIndex maps namespace -> { fsPath -> mapper }, so several source roots can
     declare the same namespace without either side losing its counterpart
  -> workspace.findFiles("**/com/foo/BarMapper.java") resolves an index miss
```

Statement elements (`select`, `insert`, `update`, `delete`) map to Java methods by `id` equality.
Missing counterparts surface as Create CodeLens actions that insert stubs before `</mapper>` or the
final closing brace.
Definition, completion, and outline providers use the same mapper index, so they stay aligned with
CodeLens and file watcher refreshes.

Pairing accuracy depends on three parse boundaries:

* Java method collection stops at the top-level interface's closing brace, and members of nested
  types are excluded, so declarations outside the mapper never register as statements.
* Each method records its declaration span (leading annotations through the terminating `;` or
  body brace) and each statement records its closing-tag line. Cursor-driven commands, hover, and
  definition resolve a counterpart only inside that span.
* `@Select`/`@Insert`/`@Update`/`@Delete` detection scans the whole annotation region back to the
  previous member boundary, so annotations with nested parentheses such as
  `@Results({ @Result(...) })` do not hide the SQL annotation.

Nested `select` references from `<association>` and `<collection>` are kept in a reverse index keyed
by `namespace.statementId`, so a statement referenced from another file is not reported as unused.

## Index And Watcher Model

`MapperIndexService` scans `**/*.xml` and `**/*.java` minus `Mybatis-Booster.searchExclude` globs
with a concurrency cap of `32`, parsing only XML files whose text contains a `<mapper namespace>`
root. Separate XML and Java `FileSystemWatcher` instances re-index changed files with a `200ms`
per-path debounce. Open documents re-parse through `syncDoc` and `getJavaMapper` so dirty editors
stay accurate, keyed by document version in a `WeakMap`.

Because those two calls write the unsaved buffer's parse into the index, closing a document without
saving would otherwise leave that buffer state in place. `onDidCloseTextDocument` therefore calls
`reindexPath` to re-read the file from disk, which is what keeps a discarded edit from producing a
phantom or missing counterpart.

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
