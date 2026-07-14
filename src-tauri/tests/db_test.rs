//! Integration tests against the dev Postgres instance (dev/docker-compose.yml).
//! Run with the containers up: `npm run db:start` then `cargo test -- --ignored`.

use bestgres_lib::db::postgres;
use serde_json::{json, Value};

const TEST_URL: &str = "postgres://postgres:postgres@127.0.0.1:5433/analytics";

/// Each test gets its own table/type (suffix) so parallel tests don't collide.
async fn setup(sfx: &str) -> sqlx::PgPool {
    let pool = postgres::create_pool(TEST_URL)
        .await
        .expect("connect to dev pg2");
    sqlx::query(&format!("DROP TABLE IF EXISTS _bestgres_test{sfx}"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&format!("DROP TYPE IF EXISTS _bestgres_mood{sfx} CASCADE"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&format!(
        "CREATE TYPE _bestgres_mood{sfx} AS ENUM ('happy', 'sad')"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(&format!(
        r#"
        CREATE TABLE _bestgres_test{sfx} (
            id serial PRIMARY KEY,
            price numeric(12,4),
            big bigint,
            flag boolean,
            ts timestamptz,
            d date,
            j jsonb,
            tags text[],
            nums integer[],
            bin bytea,
            mood _bestgres_mood{sfx},
            iv interval,
            txt text,
            "user name" text
        )
        "#,
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(&format!(
        r#"
        INSERT INTO _bestgres_test{sfx}
            (price, big, flag, ts, d, j, tags, nums, bin, mood, iv, txt, "user name")
        VALUES
            (123.4500, 9007199254740993, true, '2026-01-02T03:04:05Z', '2026-01-02',
             '{{"a": 1}}', ARRAY['x','y'], ARRAY[1,2,3], '\xdeadbeef', 'happy',
             '1 day 02:30:00', 'hello', 'spaced col'),
            (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
        "#,
    ))
    .execute(&pool)
    .await
    .unwrap();
    pool
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn decodes_all_column_types() {
    let pool = setup("_dec").await;
    let res = postgres::execute_query(&pool, "SELECT * FROM _bestgres_test_dec ORDER BY id", &[])
        .await
        .unwrap();

    assert_eq!(res.row_count, 2);
    let cols = &res.columns;
    let row = &res.rows[0];
    let get = |name: &str| -> &Value { &row[cols.iter().position(|c| c == name).unwrap()] };

    // numeric must NOT come back as NULL (the old decoder bug)
    assert_eq!(get("price"), &json!("123.4500"));
    // beyond JS Number.MAX_SAFE_INTEGER → sent as string to avoid precision loss
    assert_eq!(get("big"), &json!("9007199254740993"));
    assert_eq!(get("flag"), &json!(true));
    assert_eq!(get("j"), &json!({"a": 1}));
    assert_eq!(get("tags"), &json!(["x", "y"]));
    assert_eq!(get("nums"), &json!([1, 2, 3]));
    assert_eq!(get("bin"), &json!("\\xdeadbeef"));
    assert_eq!(
        get("mood"),
        &json!("happy"),
        "enum should decode via unchecked fallback"
    );
    assert_eq!(get("iv"), &json!("1 days 02:30:00"));
    assert_eq!(get("txt"), &json!("hello"));
    assert!(get("ts")
        .as_str()
        .unwrap()
        .starts_with("2026-01-02T03:04:05"));
    assert_eq!(get("d"), &json!("2026-01-02"));

    // The all-NULL row must be NULL everywhere (not placeholders)
    let null_row = &res.rows[1];
    for (i, c) in cols.iter().enumerate() {
        if c == "id" {
            continue;
        }
        assert_eq!(null_row[i], Value::Null, "column {} should be NULL", c);
    }
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn update_cell_casts_types_with_int_pk() {
    let pool = setup("_upd").await;
    let table = "_bestgres_test_upd";
    let pk_cols = vec!["id".to_string()];
    // PK arrives from the grid as a JSON number — this is the case that used to
    // fail with "operator does not exist: integer = text"
    let pk_vals = vec![json!(1)];

    // numeric column, value typed as a string in the UI
    let n = postgres::update_cell(
        &pool,
        "public",
        table,
        "price",
        &pk_cols,
        &pk_vals,
        &json!("999.9999"),
    )
    .await
    .unwrap();
    assert_eq!(n, 1);

    // boolean, timestamptz, jsonb, enum, array, quoted identifier — all typed as strings
    for (col, val) in [
        ("flag", "false"),
        ("ts", "2030-12-31T23:59:59Z"),
        ("j", r#"{"b": [1, 2]}"#),
        ("mood", "sad"),
        ("tags", "{a,b,c}"),
        ("user name", "edited"),
    ] {
        let n = postgres::update_cell(&pool, "public", table, col, &pk_cols, &pk_vals, &json!(val))
            .await
            .unwrap_or_else(|e| panic!("update of {} failed: {:?}", col, e));
        assert_eq!(n, 1, "update of {}", col);
    }

    // set a column to NULL
    let n = postgres::update_cell(
        &pool,
        "public",
        table,
        "txt",
        &pk_cols,
        &pk_vals,
        &Value::Null,
    )
    .await
    .unwrap();
    assert_eq!(n, 1);

    let res = postgres::execute_query(
        &pool,
        r#"SELECT price, flag, j, mood, tags, txt, "user name" FROM _bestgres_test_upd WHERE id = 1"#,
        &[],
    )
    .await
    .unwrap();
    assert_eq!(res.rows[0][0], json!("999.9999"));
    assert_eq!(res.rows[0][1], json!(false));
    assert_eq!(res.rows[0][2], json!({"b": [1, 2]}));
    assert_eq!(res.rows[0][3], json!("sad"));
    assert_eq!(res.rows[0][4], json!(["a", "b", "c"]));
    assert_eq!(res.rows[0][5], Value::Null);
    assert_eq!(res.rows[0][6], json!("edited"));

    // updating a non-existent row must error, not silently succeed
    let err = postgres::update_cell(
        &pool,
        "public",
        table,
        "txt",
        &pk_cols,
        &[json!(99999)],
        &json!("x"),
    )
    .await;
    assert!(err.is_err());
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn insert_and_delete_with_casts() {
    let pool = setup("_ins").await;
    let table = "_bestgres_test_ins";

    let n = postgres::insert_row(
        &pool,
        "public",
        table,
        &["price".into(), "flag".into(), "nums".into(), "txt".into()],
        &[
            json!("1.5"),
            json!("true"),
            json!("{7,8}"),
            json!("inserted"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(n, 1);

    let res = postgres::execute_query(
        &pool,
        "SELECT id, price, nums FROM _bestgres_test_ins WHERE txt = 'inserted'",
        &[],
    )
    .await
    .unwrap();
    assert_eq!(res.row_count, 1);
    let new_id = res.rows[0][0].clone();
    assert_eq!(res.rows[0][1], json!("1.5000"));
    assert_eq!(res.rows[0][2], json!([7, 8]));

    // delete by integer PK (used to fail for non-text PKs)
    let n = postgres::delete_rows(&pool, "public", table, &["id".to_string()], &[vec![new_id]])
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn multi_statement_params_truncation_and_affected() {
    let pool = setup("_ms").await;
    let table = "_bestgres_test_ms";

    // bound parameters are cast server-side
    let res = postgres::execute_query(&pool, "SELECT $1::int + 1 AS x", &[json!("41")])
        .await
        .unwrap();
    assert_eq!(res.rows[0][0], json!(42));

    // multi-statement script: last result set wins
    let res = postgres::execute_query(&pool, "SELECT 1 AS a; SELECT 'two' AS b;", &[])
        .await
        .unwrap();
    assert_eq!(res.columns, vec!["b"]);
    assert_eq!(res.rows[0][0], json!("two"));

    // DML reports affected rows; a trailing SELECT still returns its result set
    let sql = format!(
        "UPDATE {t} SET txt = 'bulk'; SELECT count(*) FROM {t}",
        t = table
    );
    let res = postgres::execute_query(&pool, &sql, &[]).await.unwrap();
    assert_eq!(res.rows_affected, 2);
    assert_eq!(res.rows[0][0], json!(2));

    // semicolons inside strings must not split statements
    let res = postgres::execute_query(&pool, "SELECT 'a;b' AS s", &[])
        .await
        .unwrap();
    assert_eq!(res.rows[0][0], json!("a;b"));

    // results are capped at MAX_QUERY_ROWS and flagged truncated
    let res = postgres::execute_query(&pool, "SELECT generate_series(1, 6000)", &[])
        .await
        .unwrap();
    assert!(res.truncated);
    assert_eq!(res.row_count, postgres::MAX_QUERY_ROWS);

    // a failing statement reports its position in the script
    let err = postgres::execute_query(&pool, "SELECT 1; SELECT nope_not_a_column;", &[])
        .await
        .unwrap_err();
    assert!(err.to_string().contains("Statement 2 of 2"), "got: {}", err);
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn staged_edits_apply_atomically() {
    let pool = setup("_stg").await;
    let table = "_bestgres_test_stg";
    use bestgres_lib::models::CellEdit;

    // Two valid edits on row 1 apply together
    let edits = vec![
        CellEdit {
            column: "txt".into(),
            primary_key_columns: vec!["id".into()],
            primary_key_values: vec![json!(1)],
            new_value: json!("batched"),
        },
        CellEdit {
            column: "price".into(),
            primary_key_columns: vec!["id".into()],
            primary_key_values: vec![json!(1)],
            new_value: json!("5.2500"),
        },
    ];
    let n = postgres::apply_cell_edits(&pool, "public", table, &edits)
        .await
        .unwrap();
    assert_eq!(n, 2);

    let res = postgres::execute_query(
        &pool,
        "SELECT txt, price FROM _bestgres_test_stg WHERE id = 1",
        &[],
    )
    .await
    .unwrap();
    assert_eq!(res.rows[0][0], json!("batched"));
    assert_eq!(res.rows[0][1], json!("5.2500"));

    // preview produces SQL without executing
    let preview = postgres::preview_cell_edits(&pool, "public", table, &edits)
        .await
        .unwrap();
    assert!(preview.contains("UPDATE"));
    assert_eq!(preview.lines().count(), 2);

    // A batch where the second edit matches no row must roll back the first
    let bad = vec![
        CellEdit {
            column: "txt".into(),
            primary_key_columns: vec!["id".into()],
            primary_key_values: vec![json!(1)],
            new_value: json!("should_not_persist"),
        },
        CellEdit {
            column: "txt".into(),
            primary_key_columns: vec!["id".into()],
            primary_key_values: vec![json!(999999)],
            new_value: json!("x"),
        },
    ];
    let err = postgres::apply_cell_edits(&pool, "public", table, &bad).await;
    assert!(err.is_err());
    let res = postgres::execute_query(
        &pool,
        "SELECT txt FROM _bestgres_test_stg WHERE id = 1",
        &[],
    )
    .await
    .unwrap();
    assert_eq!(
        res.rows[0][0],
        json!("batched"),
        "first edit must have rolled back"
    );
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn row_estimate_and_foreign_keys() {
    let pool = setup("_est").await;
    sqlx::query("ANALYZE _bestgres_test_est")
        .execute(&pool)
        .await
        .unwrap();

    let est = postgres::get_row_estimate(&pool, "public", "_bestgres_test_est")
        .await
        .unwrap();
    assert!(
        est >= 0,
        "estimate after ANALYZE should be >= 0, got {}",
        est
    );

    // FK detection
    sqlx::query("DROP TABLE IF EXISTS _bestgres_child_est")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE _bestgres_child_est (id serial PRIMARY KEY, parent int REFERENCES _bestgres_test_est(id))",
    )
    .execute(&pool)
    .await
    .unwrap();
    let fks = postgres::get_foreign_keys(&pool, "public", "_bestgres_child_est")
        .await
        .unwrap();
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].column_name, "parent");
    assert_eq!(fks[0].ref_table, "_bestgres_test_est");
    assert_eq!(fks[0].ref_column, "id");
    sqlx::query("DROP TABLE _bestgres_child_est")
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires dev docker postgres on :5433"]
async fn streaming_emits_columns_and_chunks() {
    let pool = setup("_strm").await;
    use bestgres_lib::db::postgres::StreamEvent;
    use std::sync::{Arc, Mutex};

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let row_total = Arc::new(Mutex::new(0usize));
    let ev = events.clone();
    let rt = row_total.clone();
    let summary = postgres::execute_query_stream(
        &pool,
        "SELECT generate_series(1, 1200) AS n",
        &[],
        500,
        move |e| {
            match &e {
                StreamEvent::Columns { columns } => ev
                    .lock()
                    .unwrap()
                    .push(format!("cols:{}", columns.join(","))),
                StreamEvent::Rows { rows } => *rt.lock().unwrap() += rows.len(),
            }
            Ok(())
        },
    )
    .await
    .unwrap();

    assert_eq!(summary.row_count, 1200);
    assert_eq!(*row_total.lock().unwrap(), 1200);
    let evs = events.lock().unwrap();
    assert_eq!(
        evs.iter().filter(|s| s.starts_with("cols:")).count(),
        1,
        "exactly one Columns event"
    );
}
