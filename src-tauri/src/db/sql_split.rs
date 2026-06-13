/// Split a SQL script into individual statements on top-level semicolons.
/// Understands line comments, nested block comments, single-quoted strings
/// (with '' and E'\' escapes), double-quoted identifiers, and dollar quoting.
pub fn split_statements(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0;
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                let mut depth = 1;
                i += 2;
                while i < bytes.len() && depth > 0 {
                    if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
                        depth += 1;
                        i += 2;
                    } else if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                        depth -= 1;
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            }
            b'\'' => {
                // E'...' strings treat backslash as an escape character
                let escape_string = i > 0 && (bytes[i - 1] == b'E' || bytes[i - 1] == b'e');
                i += 1;
                while i < bytes.len() {
                    if escape_string && bytes[i] == b'\\' {
                        i += 2;
                    } else if bytes[i] == b'\'' {
                        if bytes.get(i + 1) == Some(&b'\'') {
                            i += 2; // '' escape
                        } else {
                            i += 1;
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
            }
            b'"' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'"' {
                        if bytes.get(i + 1) == Some(&b'"') {
                            i += 2;
                        } else {
                            i += 1;
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
            }
            b'$' => {
                // Dollar quote: $tag$ ... $tag$, where tag is empty or an identifier
                if let Some(tag_len) = dollar_tag_len(&bytes[i..]) {
                    let tag = &sql[i..i + tag_len];
                    if let Some(end) = sql[i + tag_len..].find(tag) {
                        i += tag_len + end + tag_len;
                    } else {
                        i = bytes.len(); // unterminated — consume the rest
                    }
                } else {
                    i += 1;
                }
            }
            b';' => {
                let stmt = sql[start..i].trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                }
                i += 1;
                start = i;
            }
            _ => i += 1,
        }
    }

    let tail = sql[start..].trim();
    if !tail.is_empty() {
        statements.push(tail.to_string());
    }
    statements
}

/// Length of a `$tag$` opener at the start of `bytes`, or None if it isn't one.
fn dollar_tag_len(bytes: &[u8]) -> Option<usize> {
    let mut j = 1;
    while j < bytes.len() {
        match bytes[j] {
            b'$' => return Some(j + 1),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' => j += 1,
            _ => return None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::split_statements;

    #[test]
    fn splits_simple_statements() {
        assert_eq!(
            split_statements("SELECT 1; SELECT 2;"),
            vec!["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn single_statement_without_semicolon() {
        assert_eq!(split_statements("SELECT 1"), vec!["SELECT 1"]);
    }

    #[test]
    fn ignores_semicolons_in_strings_and_identifiers() {
        assert_eq!(
            split_statements(r#"SELECT 'a;b', "c;d"; SELECT 'it''s; fine'"#),
            vec![r#"SELECT 'a;b', "c;d""#, "SELECT 'it''s; fine'"]
        );
    }

    #[test]
    fn ignores_semicolons_in_comments() {
        assert_eq!(
            split_statements("SELECT 1 -- one; two\n; /* a;b /* nested; */ c */ SELECT 2"),
            vec!["SELECT 1 -- one; two", "/* a;b /* nested; */ c */ SELECT 2"]
        );
    }

    #[test]
    fn handles_dollar_quotes() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql; SELECT f()";
        let stmts = split_statements(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("END;"));
        assert_eq!(stmts[1], "SELECT f()");
    }

    #[test]
    fn handles_escape_strings() {
        assert_eq!(
            split_statements(r"SELECT E'a\';b'; SELECT 2"),
            vec![r"SELECT E'a\';b'", "SELECT 2"]
        );
    }

    #[test]
    fn empty_statements_dropped() {
        assert_eq!(split_statements(";;  ;\nSELECT 1;;"), vec!["SELECT 1"]);
    }
}
