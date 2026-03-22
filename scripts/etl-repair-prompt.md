You are fixing a failed ETL job in the market-analyst project.

## Failed Job
- **Job name**: {{JOB_NAME}}
- **Branch**: {{BRANCH_NAME}}

## Error Log
```
{{ERROR_LOG}}
```

## Related Files
{{RELATED_FILES}}

## Rules

1. **Only modify files in these directories**: `src/etl/`, `src/db/`
2. **Do NOT modify**: config files, environment variables, CI workflows, test files
3. **Do NOT create new files** unless absolutely necessary
4. **Do NOT merge any PR** — only create fixes
5. **Do NOT run any external API calls or database commands**
6. **Keep changes minimal** — fix only what's broken, don't refactor

## Task

1. Read the error log and identify the root cause
2. Find the relevant source file(s) based on the job name and error
3. Apply the minimal fix to resolve the error
4. Verify the fix makes logical sense (type safety, correct SQL, proper error handling)

## Common ETL Failure Patterns

- **Query timeout**: Optimize the query or add appropriate limits
- **Schema mismatch**: Update column references to match current schema
- **Null handling**: Add proper null checks for data that may be missing
- **Type coercion**: Fix number/string conversion issues
- **Missing index**: Add index hints or restructure query

Focus on the specific error. Do not make speculative changes.
