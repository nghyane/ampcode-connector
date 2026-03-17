# AMP CLI Agent Tools (Latest Binary)

- **Source binary:** `~/.amp/bin/amp`
- **Version:** `0.0.1773129970-gb3ab74 (released 2026-03-10T08:11:50.960Z, 2h ago)`
- **Extraction date:** 2026-03-10T11:05:25.332Z
- **Method:** `amp tools list` + `amp tools show <tool>`.

## Active Tools List

```text
23 tools available

Built-in
  Bash               Executes the given shell command using bash (or sh on systems without bash)
  chart              Render a chart visualization by running a command that produces JSON data
  create_file        Create or overwrite a file in the workspace
  edit_file          Make edits to a text file
  find_thread        Find Amp threads (conversation threads with the agent) using a query DSL
  finder             Intelligently search your codebase
  glob               Fast file pattern matching tool that works with any codebase size
  Grep               Search for exact text patterns in files using ripgrep, a fast keyword search tool
  handoff            Hand off work to a new thread that runs in the background
  librarian          The Librarian - a specialized codebase understanding agent that helps answer questions about large, complex codebases
  look_at            Extract specific information from a local file (including PDFs, images, and other media)
  mermaid            Renders a Mermaid diagram from the provided code
  oracle             Consult the oracle - an AI advisor powered by OpenAI's GPT-5
  painter            Generate an image using an AI model
  Read               Read a file or list a directory from the file system
  read_mcp_resource  Read a resource from an MCP (Model Context Protocol) server
  read_thread        Read and extract relevant content from another Amp thread by its ID
  read_web_page      Read the contents of a web page at a given URL
  skill              Load a specialized skill that provides domain-specific instructions and workflows
  Task               Perform a task (a sub-task of the user's overall task) using a sub-agent that has access to the following tools
  task_list          Plan and track tasks
  undo_edit          Undo the last edit made to a file
  web_search         Search the web for information relevant to a research objective
```

## Tool Definitions (Full Dump)

```text
===== TOOL: Bash =====
# Bash (built-in)

Executes the given shell command using bash (or sh on systems without bash).

- Do NOT chain commands with `;` or `&&` or use `&` for background processes; make separate tool calls instead
- Do NOT use interactive commands (REPLs, editors, password prompts)
- Output is truncated to the last 50000 characters
- Environment variables and `cd` do not persist between commands; use the `cwd` parameter instead
- Commands run in the workspace root by default; only use `cwd` when you need a different directory (never use `cd dir && cmd`)
- Only the last 50000 characters of the output will be returned to you along with how many lines got truncated, if any; rerun with a grep or head/tail filter if needed
- On Windows, use PowerShell commands and `\` path separators
- ALWAYS quote file paths: `cat "path with spaces/file.txt"`
- Use finder/Grep instead of find/grep, Read instead of cat, edit_file instead of sed
- Only run `git commit` and `git push` if explicitly instructed by the user.


# Schema

- cmd (string): The shell command to execute
- cwd (string): Absolute path to a directory where the command will be executed (must be absolute, not relative)


===== TOOL: chart =====
# chart (built-in)

Render a chart visualization by running a command that produces JSON data. The chart is displayed inline to the user.

Use this tool to visualize data as bar charts, line charts, or area charts. You provide a shell command that outputs JSON, and specify which columns map to the X and Y axes, the chart type, and display options.

# Parameters

- **cmd**: A shell command to execute that must produce JSON output (a JSON array of objects). The command is run via the Bash tool internally. Pipe through `jq -c .` if needed to produce compact JSON.
- **chartType**: "bar", "line", or "area"
- **xColumn**: The column name to use for the X axis (labels)
- **yColumns**: Array of column names for the Y axis. Multiple columns create multiple series (e.g., overlay revenue and expenses on the same chart).
- **title**: Chart title displayed above the chart
- **stacked**: When true with multiple yColumns, stack the series instead of overlaying them. Works with bar and area charts.
- **horizontal**: When true with bar chartType, renders horizontal bars (good for categorical data with long labels).
- **hoverColumns**: Extra column names to show in the hover tooltip but not plotted on the Y axis.
- **groupColumn**: A column whose unique values become separate series. Use with a single yColumn to pivot unpivoted data — e.g., rows with a "type" column become one series per type. Commonly used with stacked charts.

# When to use this tool

- When the user explicitly asks to "chart", "graph", "plot", or "visualize" data
- When the user explicitly requests a visual representation of data
- Do NOT use this tool proactively for tabular data unless the user asks for a visualization

# Examples

Bar chart from a BigQuery query:
{"cmd":"bq query --format=json --nouse_legacy_sql 'SELECT name, score FROM dataset.table LIMIT 10'","chartType":"bar","xColumn":"name","yColumns":["score"],"title":"Test Scores"}

Multi-series comparison:
{"cmd":"cat data.json","chartType":"bar","xColumn":"month","yColumns":["revenue","expenses"],"title":"Revenue vs Expenses"}

Horizontal bar chart:
{"cmd":"echo '[{\"tool\":\"Bash\",\"count\":42},{\"tool\":\"Read\",\"count\":31}]'","chartType":"bar","xColumn":"tool","yColumns":["count"],"title":"Tool Usage","horizontal":true}

Stacked area chart:
{"cmd":"cat commits.json","chartType":"area","xColumn":"date","yColumns":["frontend","backend"],"title":"Commits by Team","stacked":true}

Stacked area chart with groupColumn (auto-pivots rows by credit_type):
{"cmd":"bq query --format=json --nouse_legacy_sql 'SELECT hour, credits, credit_type FROM dataset.usage'","chartType":"area","xColumn":"hour","yColumns":["credits"],"groupColumn":"credit_type","title":"Credits by Type","stacked":true}

# Best practices

- Pipe through `jq -c .` if the command might produce non-JSON text (headers, warnings) or pretty-printed output that could break parsing.
- The chart renders at most 100 points per series (extra rows are silently dropped). Use aggregation (GROUP BY) or LIMIT so the JSON output stays under this threshold.
- Use `groupColumn` to pivot flat rows into multiple series instead of running separate queries or reshaping data manually.
- ISO-date xColumn values (YYYY-MM-DD…) are automatically sorted ascending; categorical labels preserve source order.
- Include a `link` key in JSON rows to make tooltip values clickable hyperlinks.
- Use `hoverColumns` to surface extra context (IDs, descriptions) in tooltips without adding chart clutter.
- Choose `horizontal: true` for bar charts when labels are long (e.g. file paths, URLs).

# Schema

- cmd (string): A shell command to execute that produces JSON output (a JSON array of objects).
- chartType (string): The type of chart to render.
- xColumn (string): Column name to use for the X axis (labels).
- yColumns (array of string): Column name(s) for the Y axis. Multiple columns create multiple series.
- title (string): Chart title.
- subtitle (string): Optional subtitle shown below the title.
- xAxisLabel (string): Label for the X axis. Defaults to the xColumn name.
- yAxisLabel (string): Label for the Y axis. Defaults to the first yColumn name.
- stacked (boolean): Stack multiple series instead of overlaying. Works with bar and area charts.
- horizontal (boolean): Render bars horizontally. Only applies to bar chartType.
- hoverColumns (array of string): Extra columns to display in hover tooltips but not plotted on the Y axis.
- groupColumn (string): Column whose unique values become separate series. Pivots unpivoted data — e.g., a "type" column creates one series per type. Use with a single yColumn.


===== TOOL: create_file =====
# create_file (built-in)

Create or overwrite a file in the workspace.

Use this tool to create a **new file** that does not yet exist.

For **existing files**, prefer `edit_file` instead—even for extensive changes. Only use `create_file` to overwrite an existing file when you are replacing nearly all of its content AND the file is small (under ~250 lines).


# Schema

- path (string): The absolute path of the file to be created (must be absolute, not relative). If the file exists, it will be overwritten. ALWAYS generate this argument first.
- content (string): The content for the file.


===== TOOL: edit_file =====
# edit_file (built-in)

Make edits to a text file.

Replaces `old_str` with `new_str` in the given file.

Returns a git-style diff showing the changes made as formatted markdown, along with the line range ([startLine, endLine]) of the changed content. The diff is also shown to the user.

The file specified by `path` MUST exist, and it MUST be an absolute path. If you need to create a new file, use `create_file` instead.

`old_str` MUST exist in the file. Use tools like `Read` to understand the files you are editing before changing them.

`old_str` and `new_str` MUST be different from each other.

Set `replace_all` to true to replace all occurrences of `old_str` in the file. Else, `old_str` MUST be unique within the file or the edit will fail. Additional lines of context can be added to make the string more unique.

If you need to replace the entire contents of a file, use `create_file` instead, since it requires less tokens for the same action (since you won't have to repeat the contents before replacing)


# Schema

- path (string): The absolute path to the file (MUST be absolute, not relative). File must exist. ALWAYS generate this argument first.
- old_str (string): Text to search for. Must match exactly.
- new_str (string): Text to replace old_str with.
- replace_all (boolean): Set to true to replace all matches of old_str. Else, old_str must be an unique match.


===== TOOL: find_thread =====
# find_thread (built-in)

Find Amp threads (conversation threads with the agent) using a query DSL.

## What this tool finds

This tool searches **Amp threads** (conversations with the agent), NOT git commits. Use this when the user asks about threads, conversations, or Amp history.

## Query syntax

- **Keywords**: Bare words or quoted phrases for text search: `auth` or `"race condition"`
- **File filter**: `file:path` to find threads that touched a file: `file:src/auth/login.ts`
- **Repo filter**: `repo:url` to scope to a repository: `repo:github.com/owner/repo` or `repo:owner/repo`
- **Author filter**: `author:name` to find threads by a user: `author:alice` or `author:me` for your own threads
- **Date filters**: `after:date` and `before:date` to filter by date: `after:2024-01-15`, `after:7d`, `before:2w`
- **Task filter**: `task:id` to find threads that worked on a task: `task:142`. Use `task:142+` to include threads that worked on the task's dependencies, `task:142^` to include dependents (tasks that depend on this task), or `task:142+^` for both.
- **Cluster filter**: `cluster_of:id` to find threads in the same cluster as a thread: `cluster_of:T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Combine filters**: Use implicit AND: `auth file:src/foo.ts repo:amp after:7d`

All matching is case-insensitive. File paths use partial matching. Date formats: ISO dates (`2024-01-15`), relative days (`7d`), or weeks (`2w`).

## When to use this tool

- "which thread touched this file" / "which thread modified this file"
- "what thread last changed X" / "find the thread that edited X"
- "find threads about X" / "search threads mentioning Y"
- Any question about Amp thread history or previous Amp conversations
- When the user says "thread" and is referring to Amp work, not git commits

## When NOT to use this tool

- If the user asks about git commits, git history, or git blame → use git commands instead
- If the user wants to know WHO (a person) made changes → use git log

# Examples

User asks: "Find threads where we discussed the monorepo migration"
```json
{"query":"monorepo migration","limit":10}
```

User asks: "Show me threads that modified src/server/index.ts"
```json
{"query":"file:src/server/index.ts","limit":5}
```

User asks: "What threads have touched this file?" (for current file in github.com/sourcegraph/amp)
```json
{"query":"file:core/src/tools/tool-service.ts repo:sourcegraph/amp"}
```

User asks: "Find auth-related threads in the amp repo"
```json
{"query":"auth repo:sourcegraph/amp"}
```

User asks: "Show me my recent threads"
```json
{"query":"author:me","limit":10}
```

User asks: "Find threads from the last week about authentication"
```json
{"query":"auth after:7d","limit":10}
```

User asks: "Which threads worked on task 142 and its dependencies?"
```json
{"query":"task:142+"}
```

User asks: "Show me all threads related to task 50 and tasks that depend on it"
```json
{"query":"task:50^"}
```


# Schema

- query (string): Search query using DSL syntax. Supports keywords, file:path, repo:url, author:name, after:date, before:date, task:id, and cluster_of:id filters.
- limit (number): Maximum number of threads to return. Defaults to 20.


===== TOOL: finder =====
# finder (built-in)

Intelligently search your codebase: Use it for complex, multi-step search tasks where you need to find code based on functionality or concepts rather than exact matches. Anytime you want to chain multiple grep calls you should use this tool.

WHEN TO USE THIS TOOL:
- You must locate code by behavior or concept
- You need to run multiple greps in sequence
- You must correlate or look for connection between several areas of the codebase.
- You must filter broad terms ("config", "logger", "cache") by context.
- You need answers to questions such as "Where do we validate JWT authentication headers?" or "Which module handles file-watcher retry logic"

WHEN NOT TO USE THIS TOOL:
- When you know the exact file path - use Read directly
- When looking for specific symbols or exact strings - use glob or Grep
- When you need to create, modify files, or run terminal commands

USAGE GUIDELINES:
1. Always spawn multiple search agents in parallel to maximise speed.
2. Formulate your query as a precise engineering request.
   ✓ "Find every place we build an HTTP error response."
   ✗ "error handling search"
3. Name concrete artifacts, patterns, or APIs to narrow scope (e.g., "Express middleware", "fs.watch debounce").
4. State explicit success criteria so the agent knows when to stop (e.g., "Return file paths and line numbers for all JWT verification calls").
5. Never issue vague or exploratory commands - be definitive and goal-oriented.


# Schema

- query (string): The search query describing to the agent what it should. Be specific and include technical terms, file types, or expected code patterns to help the agent find relevant code. Formulate the query in a way that makes it clear to the agent when it has found the right thing.


===== TOOL: glob =====
# glob (built-in)

Fast file pattern matching tool that works with any codebase size

Use this tool to find files by name patterns across your codebase. Results are returned in ripgrep's traversal order, not by modification time.

## File pattern syntax

- `**/*.js` - All JavaScript files in any directory
- `src/**/*.ts` - All TypeScript files under the src directory (searches only in src)
- `*.json` - All JSON files in the current directory
- `**/*test*` - All files with "test" in their name
- `web/src/**/*` - All files under the web/src directory
- `**/*.{js,ts}` - All JavaScript and TypeScript files (alternative patterns)
- `src/[a-z]*/*.ts` - TypeScript files in src subdirectories that start with lowercase letters

# Examples

Find all typescript files in the codebase
```json
{"filePattern":"**/*.ts"}
```

Find all test files under a specific directory
```json
{"filePattern":"src/**/*test*.ts"}
```

Search for svelte component files in the web/src directory
```json
{"filePattern":"web/src/**/*.svelte"}
```

Find up to 10 JSON files
```json
{"filePattern":"**/*.json","limit":10}
```


# Schema

- filePattern (string): Glob pattern like "**/*.js" or "src/**/*.ts" to match files
- limit (number): Maximum number of results to return (default: 200, max: 1000)
- offset (number): Number of results to skip (for pagination)


===== TOOL: Grep =====
# Grep (built-in)

Search for exact text patterns in files using ripgrep, a fast keyword search tool.

# When to use this tool
- Finding exact text matches (variable names, function calls, specific strings)
- Use finder for semantic/conceptual searches

# Strategy
- Use 'path' or 'glob' to narrow searches; run multiple focused calls rather than one broad search
- Uses Rust-style regex (escape `{` and `}`); use `literal: true` for literal text search

# Constraints
- Results are limited to 100 matches (up to 10 per file)
- Lines are truncated at 200 characters

# Examples

Find a specific function name across the codebase
```json
{"pattern":"registerTool","path":"core/src"}
```

Search for interface definitions in a specific directory
```json
{"pattern":"interface ToolDefinition","path":"core/src/tools"}
```

Use a case-sensitive search to find the exact string `ERROR:`
```json
{"pattern":"ERROR:","caseSensitive":true}
```

Find TODO comments in frontend code
```json
{"pattern":"TODO:","path":"web/src"}
```

Find a specific function name in test files
```json
{"pattern":"restoreThreads","glob":"**/*.test.ts"}
```

Find all REST API endpoint definitions
```json
{"pattern":"app\\.(get|post|put|delete)\\([\"']","path":"server"}
```

Locate CSS class definition in stylesheets
```json
{"pattern":"\\.container\\s*\\{","path":"web/src/styles"}
```

# Complementary to finder
- Use finder first to locate relevant code concepts
- Then use Grep to find specific implementations or all occurrences
- For complex tasks, iterate between both tools to refine your understanding


# Schema

- pattern (string): The pattern to search for (regex)
- path (string): The file or directory path to search in. Cannot be used with glob.
- glob (string): The glob pattern to search for. Cannot be used with path.
- caseSensitive (boolean): Whether to search case-sensitively
- literal (boolean): Whether to treat the pattern as a literal string instead of a regex


===== TOOL: handoff =====
# handoff (built-in)

Hand off work to a new thread that runs in the background. Use this tool when you need to continue work in a fresh context because:
- The current thread is getting too long and context is degrading
- You want to start a new focused task while preserving context from the current thread
- The current thread's context window is near capacity

When you call this tool:
1. A new thread will be created with relevant context from this thread
2. The new thread will start running in the background
3. The current thread continues to run - you can finish up any remaining work

When the user message tells you to continue the work or to handoff to only one new thread, you should follow to the new thread by setting follow to true.

The goal parameter should describe what work should continue in the new thread. Keep it short—a single sentence or at most one paragraph. Focus on what needs to be done next, not what was already completed.

Use the mode parameter when the user explicitly requests a different agent mode (e.g., "deep", "smart", "rush") for the new thread.

# Schema

- goal (string): A short description of the next task to accomplish in the new thread. Should be a single sentence or at most one paragraph. Focus on what needs to be done next, not what was already completed.
- follow (boolean): If true, navigate to the new thread after creation. Use this when the current thread is stopping and work should continue in the new thread.
- mode (string): The agent mode for the new thread. Defaults to the current thread's agent mode if not specified.


===== TOOL: librarian =====
# librarian (built-in)

The Librarian - a specialized codebase understanding agent that helps answer questions about large, complex codebases.
The Librarian works by reading from GitHub - it can see the private repositories the user approved access to in addition to all public repositories on GitHub.
The Librarian also supports Bitbucket Enterprise (self-hosted) repositories when the user has connected their Bitbucket Enterprise instance.

The Librarian acts as your personal multi-repository codebase expert, providing thorough analysis and comprehensive explanations across repositories.

It's ideal for complex, multi-step analysis tasks where you need to understand code architecture, functionality, and patterns across multiple repositories.

WHEN TO USE THE LIBRARIAN:
- Understanding complex multi-repository codebases and how they work
- Exploring relationships between different repositories
- Analyzing architectural patterns across large open-source projects
- Finding specific implementations across multiple codebases
- Understanding code evolution and commit history
- Getting comprehensive explanations of how major features work
- Exploring how systems are designed end-to-end across repositories

WHEN NOT TO USE THE LIBRARIAN:
- Simple local file reading (use Read directly)  
- Local codebase searches (use finder)
- Code modifications or implementations (use other tools)
- Questions not related to understanding existing repositories

USAGE GUIDELINES:
1. Be specific about what repositories or projects you want to understand
2. Provide context about what you're trying to achieve
3. The Librarian will explore thoroughly across repositories before providing comprehensive answers
4. Expect detailed, documentation-quality responses suitable for sharing
5. When getting an answer from the Librarian, show it to the user in full, do not summarize it.

EXAMPLES:
- "How does authentication work in the Kubernetes codebase?"
- "Explain the architecture of the React rendering system"
- "Find how database migrations are handled in Rails"
- "Understand the plugin system in the VSCode codebase"
- "Compare how different web frameworks handle routing"
- "What changed in commit abc123 in my private repository?"
- "Show me the diff for commit fb492e2 in github.com/mycompany/private-repo"
- "Read the README from the main API repo on our Bitbucket Enterprise instance"


# Schema

- query (string): Your question about the codebase. Be specific about what you want to understand or explore.
- context (string): Optional context about what you're trying to achieve or background information.


===== TOOL: look_at =====
# look_at (built-in)

Extract specific information from a local file (including PDFs, images, and other media).

Use this tool when you need to extract or summarize information from a file without getting the literal contents. Always provide a clear objective describing what you want to learn or extract.

Pass reference files when you need to compare two or more things.

## When to use this tool

- Analyzing PDFs, images, or media files that the Read tool cannot interpret
- Extracting specific information or summaries from documents
- Describing visual content in images or diagrams
- When you only need analyzed/extracted data, not raw file contents

## When NOT to use this tool

- For source code or plain text files where you need exact contents—use Read instead
- When you need to edit the file afterward (you need the literal content from Read)
- For simple file reading where no interpretation is needed

# Examples

Summarize a local PDF document with a specific goal
```json
{"path":"docs/specs/system-design.pdf","objective":"Summarize main architectural decisions.","context":"We are evaluating this system design for a new project we are building."}
```

Describe what is shown in an image file
```json
{"path":"assets/mockups/homepage.png","objective":"Describe the layout and main UI elements.","context":"We are creating a UI component library and need to understand the visual structure."}
```

Compare two screenshots to identify visual differences
```json
{"path":"screenshots/before.png","objective":"Identify all visual differences between the two screenshots.","context":"We are reviewing UI changes for a feature update and need to document all differences.","referenceFiles":["screenshots/after.png"]}
```


# Schema

- path (string): Absolute path to the file to analyze.
- objective (string): Natural-language description of the analysis goal (e.g., summarize, extract data, describe image).
- context (string): The broader goal and context for the analysis. Include relevant background information about what you are trying to achieve and why this analysis is needed.
- referenceFiles (array of string): Optional list of absolute paths to reference files for comparison (e.g., to compare two screenshots or documents).


===== TOOL: mermaid =====
# mermaid (built-in)

Renders a Mermaid diagram from the provided code.

PROACTIVELY USE DIAGRAMS when they would better convey information than prose alone. The diagrams produced by this tool are shown to the user.

You should create diagrams WITHOUT being explicitly asked in these scenarios:
- When explaining system architecture or component relationships
- When describing workflows, data flows, or user journeys
- When explaining algorithms or complex processes
- When illustrating class hierarchies or entity relationships
- When showing state transitions or event sequences

Diagrams are especially valuable for visualizing:
- Application architecture and dependencies
- API interactions and data flow
- Component hierarchies and relationships
- State machines and transitions
- Sequence and timing of operations
- Decision trees and conditional logic

# Citations
- **Always include `citations` to as many nodes and edges as possible to make diagram elements clickable, linking to code locations.**
- Do not add wrong citation and if needed read the file again to validate the code links.
- Keys: node IDs (e.g., `"api"`) or edge labels (e.g., `"authenticate(token)"`)
- Values: file:// URIs with optional line range (e.g., `file:///src/api.ts#L10-L50`)

<examples>

Flowchart with clickable nodes
<example>
{"code":"flowchart LR\n    api[API Layer] --> svc[Service Layer]\n    svc --> db[(Database)]","citations":{"api":"file:///src/api/routes.ts#L1-L100","svc":"file:///src/services/index.ts#L10-L50","db":"file:///src/models/schema.ts"}}
</example>

Sequence diagram with clickable actors AND messages
<example>
{"code":"sequenceDiagram\n    Client->>Server: authenticate(token)\n    Server->>DB: validate_token()","citations":{"Client":"file:///src/client/index.ts","Server":"file:///src/server/handler.ts","authenticate(token)":"file:///src/server/auth.ts#L25-L40","validate_token()":"file:///src/db/tokens.ts#L10-L30"}}
</example>

</examples>

# Styling
- When defining custom classDefs, always define fill color, stroke color, and text color ("fill", "stroke", "color") explicitly
- IMPORTANT!!! Use DARK fill colors (close to #000) with light stroke and text colors (close to #fff)

# Schema

- code (string): The Mermaid diagram code to render (DO NOT override with custom colors or other styles, DO NOT use HTML tags in node labels)
- citations (object): REQUIRED: Map of citation keys to file:// URIs for clickable code navigation. Keys can be node IDs (e.g., "api") or edge labels (e.g., "run_rollout(request)"). Use {} if no code references apply.


===== TOOL: oracle =====
# oracle (built-in)

Consult the oracle - an AI advisor powered by OpenAI's GPT-5.4 reasoning model that can plan, review, and provide expert guidance.

The oracle has access to the following tools:
- Read
- Grep
- glob
- web_search
- read_web_page
- read_thread
- find_thread.

You should consult the oracle for:
- Code reviews and architecture feedback
- Finding difficult bugs in codepaths that flow across many files
- Planning complex implementations or refactors
- Answering complex technical questions that require deep technical reasoning
- Providing an alternative point of view when you are struggling to solve a problem

You should NOT consult the oracle for:
- File reads or simple keyword searches (use Read or Grep directly)
- Codebase searches (use finder)
- Web browsing and searching (use read_web_page or web_search)
- Basic code modifications and when you need to execute code changes (do it yourself or use Task)

Usage guidelines:
- Be specific about what you want the oracle to review, plan, or debug
- Provide relevant context about what you're trying to achieve. If you know that 3 files are involved, list them and they will be attached.

# Examples

Review the authentication system architecture and suggest improvements
```json
{"task":"Review the authentication architecture and suggest improvements","files":["src/auth/index.ts","src/auth/jwt.ts"]}
```

Plan the implementation of real-time collaboration features
```json
{"task":"Plan the implementation of real-time collaboration feature"}
```

Analyze the performance bottlenecks in the data processing pipeline
```json
{"task":"Analyze performance bottlenecks","context":"Users report slow response times when processing large datasets"}
```

Review this API design and suggest better patterns
```json
{"task":"Review API design","context":"This is a REST API for user management","files":["src/api/users.ts"]}
```

Debug failing tests after refactor
```json
{"task":"Help debug why tests are failing","context":"Tests fail with \"undefined is not a function\" after refactoring the auth module","files":["src/auth/auth.test.ts"]}
```


# Schema

- task (string): The task or question you want the oracle to help with. Be specific about what kind of guidance, review, or planning you need.
- context (string): Optional context about the current situation, what you've tried, or background information that would help the oracle provide better guidance.
- files (array of string): Optional list of specific file paths (text files, images) that the oracle should examine as part of its analysis. These files will be attached to the oracle input.


===== TOOL: painter =====
# painter (built-in)

Generate an image using an AI model.

IMPORTANT: Only invoke this tool when the user explicitly asks to use the "painter" tool. Do not use this tool automatically or proactively.

- When using this tool, request a single image at a time. Multiple input reference images are OK.
- Use savePath to specify the output file path only if the user explicitly asks for it.

## When to use this tool

- When the user explicitly asks to use the "painter" tool
- When the user explicitly requests image generation using this tool

## When NOT to use this tool

- Do NOT use automatically for UI mockups, diagrams, or icons—only unless explicitly requested by user
- For code-linked diagrams—use the "mermaid" tool instead
- For analyzing existing images—use the "look_at" tool instead

## Example Scenarios

- **Generate a image from user description**: Provide only a prompt with detailed visual instructions. No inputImagePaths needed.
- **Create with reference**: Provide one or more reference images provided by the user for style/content inspiration. The model will use these as guidance to create a new image matching your prompt. Your prompt should describe how to use each reference (e.g., "match the color palette from the first image", "use the icon style from the second").
- **Edit/composite images**: Provide the image to edit and optionally another image with elements to incorporate. The prompt should describe what to change or how to combine them.

# Examples

Generate an app icon for a CLI tool
```json
{"prompt":"1024x1024 app icon. Dark background #1a1a2e. Glowing terminal cursor symbol in cyan #00d9ff. Minimal, modern style for macOS dock."}
```

Generate a hero image using existing brand assets as reference
```json
{"prompt":"Hero image for documentation landing page. Match the color palette from the first image and icon style from the second. Abstract flowing code symbols. 1920x600 dimensions.","inputImagePaths":["/Users/alice/project/docs/assets/brand-colors.png","/Users/alice/project/docs/assets/icon-style.png"]}
```

Redact sensitive data from a terminal screenshot
```json
{"prompt":"Blur or redact any visible API keys, tokens, passwords, or email addresses in this terminal screenshot. Keep command output readable. Preserve dimensions.","inputImagePaths":["/Users/alice/project/docs/screenshots/terminal-output.png"]}
```

Generate an image and save to the Documents folder (Windows)
```json
{"prompt":"A modern company logo with blue and white colors. Clean, minimalist design.","savePath":"C:\\Users\\alice\\Documents\\logo.png"}
```


# Schema

- prompt (string): Detailed instructions for image generation based on user requirements. Include specifics about design, layout, style, colors, composition, and any other visual details the user mentioned.
- inputImagePaths (array of string): Optional image paths provided by the user for editing or style guidance. Maximum 3 images allowed. Each image path should be same as the `sourcePath` provided by the user.
- savePath (string): Optional absolute path to save the generated image (e.g., C:/Users/name/Documents/image.png on Windows, /home/user/Documents/image.png on Linux/Mac). Only valid when a single image is generated.


===== TOOL: Read =====
# Read (built-in)

Read a file or list a directory from the file system. If the path is a directory, it returns a line-numbered list of entries. If the file or directory doesn't exist, an error is returned.

- The path parameter MUST be an absolute path.
- By default, this tool returns the first 500 lines. To read more, call it multiple times with different read_ranges.
- Use the Grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- The contents are returned with each line prefixed by its line number. For example, if a file has contents "abc\
", you will receive "1: abc\
". For directories, entries are returned one per line (without line numbers) with a trailing "/" for subdirectories.
- This tool can read images (such as PNG, JPEG, and GIF files) and present them to the model visually.
- When possible, call this tool in parallel for all files you will want to read.
      - Avoid tiny repeated slices (e.g., 50\u2011line chunks). If you need more context from the same file, read a larger range or the full default window instead.

# Schema

- path (string): The absolute path to the file or directory (MUST be absolute, not relative).
- read_range (array of number): An array of two integers specifying the start and end line numbers to view. Line numbers are 1-indexed. If not provided, defaults to [1, 1000]. Examples: [500, 700], [700, 1400]


===== TOOL: read_mcp_resource =====
# read_mcp_resource (built-in)

Read a resource from an MCP (Model Context Protocol) server.

Use when the user references an MCP resource, e.g. "read @filesystem-server:file:///path/to/document.txt"

# Examples

Read a file from an MCP file server
```json
{"server":"filesystem-server","uri":"file:///path/to/document.txt"}
```

Read a database record from an MCP database server
```json
{"server":"database-server","uri":"db://users/123"}
```


# Schema

- server (string): The name or identifier of the MCP server to read from
- uri (string): The URI of the resource to read


===== TOOL: read_thread =====
# read_thread (built-in)

Read and extract relevant content from another Amp thread by its ID.

This tool fetches a thread (locally or from the server if synced), renders it as markdown, and uses AI to extract only the information relevant to your specific goal. This keeps context concise while preserving important details.

## When to use this tool

- When the user pastes or references an Amp thread URL (format: https://ampcode.com/threads/T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) in their message
- When the user references a thread ID (format: T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or @T-abc123)
- When the user asks to "apply the same approach from [thread URL]"
- When the user says "do what we did in [thread URL]"
- When the user says "implement the plan we devised in [thread URL]"
- When you need to extract specific information from a referenced thread

## When NOT to use this tool

- When no thread ID is mentioned
- When working within the current thread (context is already available)

## Parameters

- **threadID**: The thread identifier in format T-{uuid} (e.g., "T-a38f981d-52da-47b1-818c-fbaa9ab56e0c")
- **goal**: A clear description of what information you're looking for in that thread. Be specific about what you need to extract.

# Examples

User asks "Implement the plan we devised in https://ampcode.com/threads/T-3f1beb2b-bded-4fda-96cc-1af7192f24b6"
```json
{"threadID":"T-3f1beb2b-bded-4fda-96cc-1af7192f24b6","goal":"Extract the implementation plan, design decisions, architecture approach, and any code patterns or examples discussed"}
```

User asks: "Do what we did in https://ampcode.com/threads/T-f916b832-c070-4853-8ab3-5e7596953bec, but for the Oracle tool"
```json
{"threadID":"T-f916b832-c070-4853-8ab3-5e7596953bec","goal":"Extract the implementation approach, code patterns, techniques used, and any relevant code examples that can be adapted for the Oracle tool"}
```

User asks: "Take the SQL queries from https://ampcode.com/threads/T-95e73a95-f4fe-4f22-8d5c-6297467c97a5 and turn it into a reusable script"
```json
{"threadID":"T-95e73a95-f4fe-4f22-8d5c-6297467c97a5","goal":"Extract all SQL queries, their purpose, parameters, and any context needed to understand how to make them reusable"}
```

User asks: "Apply the same fix from @T-def456 to this issue"
```json
{"threadID":"T-def456","goal":"Extract the bug description, root cause, the fix/solution, and relevant code changes"}
```


# Schema

- threadID (string): The thread ID in format T-{uuid} (e.g., "T-a38f981d-52da-47b1-818c-fbaa9ab56e0c")
- goal (string): A clear description of what information you need from the thread. Be specific about what to extract.


===== TOOL: read_web_page =====
# read_web_page (built-in)

Read the contents of a web page at a given URL.

When only the url parameter is set, it returns the contents of the webpage converted to Markdown.

When an objective is provided, it returns excerpts relevant to that objective.

If the user asks for the latest or recent contents, pass `forceRefetch: true` to ensure the latest content is fetched.

Do NOT use for access to localhost or any other local or non-Internet-accessible URLs; use `curl` via the Bash instead.

# Examples

Summarize recent changes for a library. Force refresh because freshness is important.
```json
{"url":"https://example.com/changelog","objective":"Summarize the API changes in this software library.","forceRefetch":true}
```

Extract all text content from a web page
```json
{"url":"https://example.com/docs/getting-started"}
```


# Schema

- url (string): The URL of the web page to read
- objective (string): A natural-language description of the research goal. If set, only relevant excerpts will be returned. If not set, the full content of the web page will be returned. 
- forceRefetch (boolean): Force a live fetch of the URL (default: use a cached version that may be a few days old)


===== TOOL: skill =====
# skill (built-in)

Load a specialized skill that provides domain-specific instructions and workflows.

When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.

The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.

Parameters:
- name: The name of the skill to load (must match one of the skills listed below)

Example: To use the web-browser skill for interacting with web pages, call this tool with name: "web-browser"

# Available Skills

{{AVAILABLE_SKILLS}}

# Schema

- name (string): The name of the skill to load
- arguments (string): Optional arguments to pass to the skill


===== TOOL: Task =====
# Task (built-in)

Perform a task (a sub-task of the user's overall task) using a sub-agent that has access to the following tools: Grep, glob, Read, Bash, edit_file, create_file, read_web_page, get_diagnostics, web_search, finder, skill, task_list.


When to use the Task tool:
- When you need to perform complex multi-step tasks
- When you need to run an operation that will produce a lot of output (tokens) that is not needed after the sub-agent's task completes
- When you are making changes across many layers of an application (frontend, backend, API layer, etc.), after you have first planned and spec'd out the changes so they can be implemented independently by multiple sub-agents
- When the user asks you to launch an "agent" or "subagent", because the user assumes that the agent will do a good job

When NOT to use the Task tool:
- When you are performing a single logical task, such as adding a new feature to a single part of an application.
- When you're reading a single file (use Read), performing a text search (use Grep), editing a single file (use edit_file)
- When you're not sure what changes you want to make. Use all tools available to you to determine the changes to make.

How to use the Task tool:
- Run multiple sub-agents concurrently if the tasks may be performed independently (e.g., if they do not involve editing the same parts of the same file), by including multiple tool uses in a single assistant message.
- You will not see the individual steps of the sub-agent's execution, and you can't communicate with it until it finishes, at which point you will receive a summary of its work.
- Include all necessary context from the user's message and prior assistant steps, as well as a detailed plan for the task, in the task description. Be specific about what the sub-agent should return when finished to summarize its work.
- Tell the sub-agent how to verify its work if possible (e.g., by mentioning the relevant test commands to run).
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.


# Schema

- prompt (string): The task for the agent to perform. Be specific about what needs to be done and include any relevant context.
- description (string): A very short description of the task that can be displayed to the user.


===== TOOL: task_list =====
# task_list (built-in)

Plan and track tasks. Use this tool for ALL task planning - breaking down work into steps, tracking progress, and managing what needs to be done.

Actions:
- create: Create a new task with title (required), description, repoURL, status, dependsOn, parentID
- list: List tasks with optional filters (repoURL, status, limit, ready). Completed tasks are excluded by default; use status filter to include them.
- get: Get a single task by taskID
- update: Update a task by taskID with new values
- delete: Soft delete a task by taskID

Use dependsOn to specify task dependencies - an array of task IDs that block this task. If B dependsOn A, then A blocks B (A must complete before B can start). Use `ready: true` with the list action to find tasks where all blockers are completed. Use parentID to establish parent-child relationships between tasks (for hierarchical task breakdown). Tasks persist across sessions and the creating thread ID is automatically recorded.

Write task descriptions with enough context that a future thread can pick up the work without needing the original conversation. Include relevant file paths, function names, error messages, or acceptance criteria.

# Examples

Run the build and fix any type errors:
```
create "Run the build" → gets id "build"
create "Fix type errors", dependsOn: ["build"]
[run build, find 3 errors]
create task for each error, each dependsOn: ["build"]
update "build" → completed
[fix first error]
update that task → completed
[continue...]
```

Build a new API feature (mixed sequential and parallel):
```
create "Design API schema" → gets id "design"
create "Set up database tables", dependsOn: ["design"] → gets id "db"
create "Implement API endpoints", dependsOn: ["design"] → gets id "api"
create "Write backend tests", dependsOn: ["api"] → gets id "backend-tests"
create "Build frontend components", dependsOn: ["api"] → gets id "frontend"
create "Integration tests", dependsOn: ["backend-tests", "frontend"] → gets id "integration"
create "Deploy to staging", dependsOn: ["integration"]
```
- db and api are parallel (both blocked by design)
- backend-tests chains after api
- frontend chains after api
- integration waits for BOTH backend-tests and frontend
- deploy is the final step

# Schema

- action (string): The action to perform
- taskID (string): Task ID (required for get, update, delete)
- title (string): Task title (required for create, optional for update)
- description (string): Task description
- repoURL (string): Repository URL to associate with the task
- status (string): Task status
- dependsOn (array of string): Array of task IDs this task depends on - should be done after these tasks
- parentID (string): Parent task ID for hierarchical task breakdown
- limit (number): Maximum number of tasks to return (for list action)
- ready (boolean): Filter to only return tasks that are ready to work on (all dependencies completed)


===== TOOL: undo_edit =====
# undo_edit (built-in)

Undo the last edit made to a file.

This command reverts the most recent edit made to the specified file.
It will restore the file to its state before the last edit was made.

Returns a git-style diff showing the changes that were undone as formatted markdown.


# Schema

- path (string): The absolute path to the file whose last edit should be undone (must be absolute, not relative)


===== TOOL: web_search =====
# web_search (built-in)

Search the web for information relevant to a research objective.

Use when you need up-to-date or precise documentation. Use `read_web_page` to fetch full content from a specific URL.

# Examples

Get API documentation for a specific provider
```json
{"objective":"I want to know the request fields for the Stripe billing create customer API. Prefer Stripe's docs site."}
```

See usage documentation for newly released library features
```json
{"objective":"I want to know how to use SvelteKit remote functions, which is a new feature shipped in the last month.","search_queries":["sveltekit","remote function"]}
```


# Schema

- objective (string): A natural-language description of the broader task or research goal, including any source or freshness guidance
- search_queries (array of string): Optional keyword queries to ensure matches for specific terms are prioritized (recommended for best results)
- max_results (number): The maximum number of results to return (default: 5)
```
