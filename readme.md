# Mybatis-Booster

Mybatis-Booster is a VS Code extension that connects MyBatis Java mapper interfaces and XML mapper files.
It is a clean-room reimplementation of the core MybatisX features in pure TypeScript, without the
Red Hat Java extension or JDT language-server dependency.

## Features

- Highlight SQL keywords, comments, strings, and numbers inside MyBatis XML mapper and SQL files, and inside `@Select`/`@Insert`/`@Update`/`@Delete` annotation strings in Java.
- Jump between Java mapper interfaces and XML mapper statements through CodeLens.
- Use Go to Definition between Java mapper methods and XML statements, including from service call sites.
- Inspect mapper links, missing counterparts, and the rendered statement SQL through hover text.
- Show MyBatis XML mappers in the VS Code outline and symbol picker.
- Complete missing XML statement `id`, `#{}` bindings, `refid`, and `resultMap` values.
- Diagnose mapper problems: missing, unused, and duplicate statements, unknown references and bindings, OGNL char literals, namespace mismatch, missing `WHERE`, missing select result, unescaped `<`, and overloaded methods.
- Apply Quick Fixes for missing and unused statements, namespace mismatch, and OGNL char literals.
- Create a missing XML statement stub from a Java mapper method, and a missing Java method stub from an XML statement.
- Preview the rendered SQL of a statement by expanding its dynamic tags.
- Convert MyBatis `Preparing:` / `Parameters:` log lines into runnable SQL, and jump from a log line to its XML statement.
- Insert MyBatis XML snippets (`mapper`, `resultMap`, `select`, `insert`, `update`, `delete`, `sql`, `include`, `if`, `where`, `foreach`, `CD`, `choose`, `set`, `trim`, `bind`, `selectKey`, `paging`, `whereif`, `insertBatch`, `insertKey`, `association`, `collection`).

## Commands

| Command | Purpose |
| --- | --- |
| `Mybatis-Booster.gotoxml` | Jump from the active Java mapper to its XML mapper statement. |
| `Mybatis-Booster.gotojava` | Jump from the active XML mapper to its Java mapper method. |
| `Mybatis-Booster.refreshmapper` | Rescan the workspace and rebuild the XML mapper index. |
| `Mybatis-Booster.formatlog` | Convert selected or clipboard MyBatis log text into SQL. |
| `Mybatis-Booster.previewsql` | Expand a statement's dynamic tags and open the rendered SQL. |
| `Mybatis-Booster.gotologstatement` | Jump from a selected or clipboard log line to its XML statement. |
| `Mybatis-Booster.openLogOutput` | Open the Mybatis-Booster output channel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `Mybatis-Booster.logLevel` | `info` | Controls extension logging: `off`, `debug`, `info`, `hint`, `warn`, `error`. |
| `Mybatis-Booster.sqlKeywordColor` | `#c586c0` | Highlight color for SQL keywords in XML mapper and SQL files. |
| `Mybatis-Booster.sqlDangerColor` | `#F44747` | Highlight color for destructive SQL keywords. |
| `Mybatis-Booster.sqlStringColor` | `#f4d4ae` | Highlight color for SQL string literals. |
| `Mybatis-Booster.sqlNumberColor` | `#00FF00` | Highlight color for SQL numeric literals. |
| `Mybatis-Booster.sqlCommentColor` | `#fffb90e8` | Highlight color for SQL-native comments. |
| `Mybatis-Booster.sqlInvalidCommentColor` | `#5d9b5d` | Highlight color for comments that do not belong to the current document language. |
| `Mybatis-Booster.sqlHighlightEnabled` | `true` | Enables SQL syntax highlighting. |
| `Mybatis-Booster.maxDocumentLength` | `300000` | Skips syntax highlighting above this document length. |
| `Mybatis-Booster.codeLensEnabled` | `true` | Enables Java and XML navigation CodeLens. |
| `Mybatis-Booster.languageFeaturesEnabled` | `true` | Enables Go to Definition, hover, XML completion, document symbols, and Quick Fixes. |
| `Mybatis-Booster.diagnosticsEnabled` | `true` | Enables MyBatis mapper diagnostics. |
| `Mybatis-Booster.disabledDiagnosticCodes` | `[]` | Diagnostic codes to suppress while diagnostics remain enabled. |
| `Mybatis-Booster.searchExclude` | build dirs | Glob patterns excluded from XML mapper scanning. |

## Diagnostics

| Code | Meaning |
| --- | --- |
| `missing-mybatis-statement` | Java mapper method has no XML statement. |
| `unused-mybatis-statement` | XML statement has no Java mapper method. |
| `duplicate-mybatis-id` | Duplicate statement, resultMap, or SQL fragment id in the mapper. |
| `unknown-mybatis-reference` | `refid`, `resultMap`, or `extends` points to an unknown target. |
| `unknown-mybatis-binding` | `#{}` or foreach collection uses an unknown parameter. |
| `mybatis-ognl-char-literal` | `<if test>` compares a single-quote char literal with a String. |
| `mybatis-namespace-mismatch` | Namespace does not match any Java mapper interface. |
| `mybatis-missing-where` | `update` or `delete` has no `WHERE` clause. |
| `mybatis-select-no-result` | `select` declares neither `resultType` nor `resultMap`. |
| `mybatis-unescaped-lt` | Raw `<` outside CDATA breaks XML parsing. |
| `mybatis-overloaded-method` | Mapper interface declares overloaded methods. |

## How It Works

- XML mapper files are detected by their `<mapper namespace="...">` root element.
- The namespace is matched against Java files by package path (`com.foo.BarMapper` to `**/com/foo/BarMapper.java`).
- Statement elements (`select`, `insert`, `update`, `delete`) are matched to Java methods by `id`.
- Log conversion fills each `?` placeholder in order (skipping `?` inside string literals), strips the `(Type)` suffix, and handles multiple `Preparing:` statements in one paste.

## Origin

This project reimplements the feature set of the closed-source `yangbaopan.vscode-java-ibatisx`
extension. No original source code is reused; navigation, highlighting, and log conversion are
independent implementations layered on the simple-bookmark project structure.
