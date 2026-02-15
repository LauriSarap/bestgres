import React, { useRef, useCallback, useEffect } from "react";

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER",
  "DROP", "TABLE", "INTO", "VALUES", "SET", "JOIN", "LEFT", "RIGHT", "INNER",
  "OUTER", "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "IS", "NULL",
  "AS", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "DISTINCT",
  "UNION", "ALL", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "CASE", "WHEN",
  "THEN", "ELSE", "END", "WITH", "RETURNING", "INDEX", "CONSTRAINT",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "CASCADE", "RESTRICT",
  "CHECK", "UNIQUE", "ASC", "DESC", "TRUE", "FALSE", "BEGIN", "COMMIT",
  "ROLLBACK", "GRANT", "REVOKE", "EXPLAIN", "ANALYZE", "IF", "REPLACE",
  "VIEW", "SCHEMA", "DATABASE", "TYPE", "ENUM", "SERIAL", "BIGSERIAL",
  "SMALLSERIAL", "TRIGGER", "FUNCTION", "PROCEDURE", "RETURNS", "LANGUAGE",
  "VOLATILE", "STABLE", "IMMUTABLE", "SECURITY", "DEFINER", "INVOKER",
  "RECURSIVE", "LATERAL", "EXCEPT", "INTERSECT", "FETCH", "FIRST", "NEXT",
  "ONLY", "ROWS", "OVER", "PARTITION", "WINDOW", "RANGE", "PRECEDING",
  "FOLLOWING", "UNBOUNDED", "CURRENT", "ROW",
]);

const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CAST", "NULLIF",
  "ARRAY_AGG", "STRING_AGG", "JSON_AGG", "JSONB_AGG", "JSON_BUILD_OBJECT",
  "JSONB_BUILD_OBJECT", "NOW", "CURRENT_TIMESTAMP", "CURRENT_DATE",
  "CURRENT_TIME", "EXTRACT", "DATE_TRUNC", "TO_CHAR", "TO_DATE",
  "TO_TIMESTAMP", "TO_NUMBER", "UPPER", "LOWER", "TRIM", "LTRIM", "RTRIM",
  "LENGTH", "SUBSTRING", "REPLACE", "CONCAT", "CONCAT_WS", "SPLIT_PART",
  "REGEXP_MATCHES", "REGEXP_REPLACE", "REGEXP_SPLIT_TO_TABLE", "ROW_NUMBER",
  "RANK", "DENSE_RANK", "LEAD", "LAG", "FIRST_VALUE", "LAST_VALUE",
  "NTH_VALUE", "NTILE", "GENERATE_SERIES", "UNNEST", "ARRAY_LENGTH",
  "GEN_RANDOM_UUID",
]);

const SQL_TYPES = new Set([
  "INTEGER", "INT", "INT2", "INT4", "INT8", "BIGINT", "SMALLINT", "SERIAL",
  "BIGSERIAL", "REAL", "FLOAT", "FLOAT4", "FLOAT8", "DOUBLE", "PRECISION",
  "NUMERIC", "DECIMAL", "BOOLEAN", "BOOL", "TEXT", "VARCHAR", "CHAR",
  "CHARACTER", "UUID", "JSON", "JSONB", "TIMESTAMP", "TIMESTAMPTZ", "DATE",
  "TIME", "TIMETZ", "INTERVAL", "BYTEA", "OID", "MONEY", "INET", "CIDR",
  "MACADDR", "BIT", "VARBIT", "XML", "POINT", "LINE", "LSEG", "BOX",
  "PATH", "POLYGON", "CIRCLE", "TSVECTOR", "TSQUERY",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightSql(sql: string): string {
  // Tokenize with regex — order matters
  const tokenPattern =
    /(--[^\n]*)|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)|([^\s\w])/g;

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(sql)) !== null) {
    // Add any whitespace between tokens
    if (match.index > lastIndex) {
      result += escapeHtml(sql.slice(lastIndex, match.index));
    }

    const [fullMatch, comment, string, number, word] = match;

    if (comment) {
      result += `<span class="sql-comment">${escapeHtml(comment)}</span>`;
    } else if (string) {
      result += `<span class="sql-string">${escapeHtml(string)}</span>`;
    } else if (number) {
      result += `<span class="sql-number">${escapeHtml(number)}</span>`;
    } else if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        result += `<span class="sql-keyword">${escapeHtml(word)}</span>`;
      } else if (SQL_FUNCTIONS.has(upper)) {
        result += `<span class="sql-function">${escapeHtml(word)}</span>`;
      } else if (SQL_TYPES.has(upper)) {
        result += `<span class="sql-type">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
    } else {
      result += escapeHtml(fullMatch);
    }

    lastIndex = tokenPattern.lastIndex;
  }

  // Remaining text
  if (lastIndex < sql.length) {
    result += escapeHtml(sql.slice(lastIndex));
  }

  // Ensure trailing newline so the pre matches textarea height
  if (result.endsWith("\n") || sql.endsWith("\n")) {
    result += " ";
  }

  return result;
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  className?: string;
}

export const SqlEditor = React.memo(function SqlEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
}: SqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content (no internal scrollbar)
  const syncHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useEffect(() => {
    syncHeight();
  }, [value, syncHeight]);

  // Handle tab key for indentation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = value.slice(0, start) + "  " + value.slice(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
        return;
      }
      onKeyDown?.(e);
    },
    [value, onChange, onKeyDown]
  );

  const highlighted = highlightSql(value);

  return (
    <div className={`sql-editor-container overflow-auto resize-y ${className ?? ""}`} style={{ maxHeight: "50vh" }}>
      <div className="relative" style={{ minHeight: "100%" }}>
        <pre
          className="sql-editor-highlight pointer-events-none absolute inset-0"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="sql-editor-textarea selectable relative z-10 w-full overflow-hidden resize-none bg-transparent caret-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          rows={1}
        />
      </div>
    </div>
  );
});
