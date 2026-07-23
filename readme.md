# Mybatis

Mybatis is a VS Code extension that connects MyBatis Java mapper interfaces and XML mapper files.
It is a clean-room reimplementation of the core MybatisX features in pure TypeScript, without the
Red Hat Java extension or JDT language-server dependency.

## Features

- Highlight SQL keywords, comments, strings, and numbers inside MyBatis XML mapper and SQL files.
- Jump between Java mapper interfaces and XML mapper statements through CodeLens.
- Use Go to Definition between Java mapper methods and XML statements.
- Inspect mapper links and missing counterparts through hover text.
- Show MyBatis XML mappers in the VS Code outline and symbol picker.
- Complete missing XML statement `id` values from Java mapper methods.
- Create a missing XML statement stub from a Java mapper method.
- Create a missing Java method stub from an XML statement.
- Convert MyBatis `Preparing:` / `Parameters:` log lines into runnable SQL.
- Insert MyBatis XML snippets (`mapper`, `resultMap`, `select`, `insert`, `update`, `delete`, `sql`, `include`, `if`, `where`, `foreach`, `CD`).

## Commands

| Command | Purpose |
| --- | --- |
| `Mybatis.gotoxml` | Jump from the active Java mapper to its XML mapper statement. |
| `Mybatis.gotojava` | Jump from the active XML mapper to its Java mapper method. |
| `Mybatis.refreshmapper` | Rescan the workspace and rebuild the XML mapper index. |
| `Mybatis.formatlog` | Convert selected or clipboard MyBatis log text into SQL. |
| `Mybatis.openLogOutput` | Open the Mybatis output channel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `Mybatis.logLevel` | `info` | Controls extension logging: `off`, `debug`, `info`, `warn`, `error`. |
| `Mybatis.sqlKeywordColor` | `#24BFA5` | Highlight color for SQL keywords in XML mapper and SQL files. |
| `Mybatis.sqlDangerColor` | `#F44747` | Highlight color for destructive SQL keywords. |
| `Mybatis.sqlStringColor` | `#f4d4ae` | Highlight color for SQL string literals. |
| `Mybatis.sqlNumberColor` | `#00FF00` | Highlight color for SQL numeric literals. |
| `Mybatis.sqlCommentColor` | `#ffff00` | Highlight color for SQL-native comments. |
| `Mybatis.sqlInvalidCommentColor` | `#5d9b5d` | Highlight color for comments that do not belong to the current document language. |
| `Mybatis.sqlHighlightEnabled` | `true` | Enables SQL syntax highlighting. |
| `Mybatis.maxDocumentLength` | `300000` | Skips syntax highlighting above this document length. |
| `Mybatis.codeLensEnabled` | `true` | Enables Java and XML navigation CodeLens. |
| `Mybatis.languageFeaturesEnabled` | `true` | Enables Go to Definition, hover, XML completion, and document symbols. |
| `Mybatis.searchExclude` | build dirs | Glob patterns excluded from XML mapper scanning. |

## How It Works

- XML mapper files are detected by their `<mapper namespace="...">` root element.
- The namespace is matched against Java files by package path (`com.foo.BarMapper` to `**/com/foo/BarMapper.java`).
- Statement elements (`select`, `insert`, `update`, `delete`) are matched to Java methods by `id`.
- Log conversion fills each `?` placeholder in order and strips the `(Type)` suffix from parameters.

## Origin

This project reimplements the feature set of the closed-source `yangbaopan.vscode-java-ibatisx`
extension. No original source code is reused; navigation, highlighting, and log conversion are
independent implementations layered on the simple-bookmark project structure.
