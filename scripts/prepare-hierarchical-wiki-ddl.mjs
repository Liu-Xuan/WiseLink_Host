import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOfficialSchemaSnapshot } from './prepare-derived-summary-ddl.mjs';

const scopes = ['authenticated', 'service_role', 'anon'];
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
export function prepareHierarchicalWikiDdl({
  template,
  devSnapshot,
  onlineSnapshot,
}) {
  const dev = parseOfficialSchemaSnapshot(devSnapshot),
    online = parseOfficialSchemaSnapshot(onlineSnapshot);
  if (
    dev.schema !== online.schema ||
    !template.includes('-- @hierarchical-wiki:prepare-required')
  )
    throw new Error('WIKI_DDL_SCOPE_MISMATCH');
  const expected = [];
  let output = template.replace(
    /(\$[a-z_]*\$)[\s\S]*?\1|CREATE POLICY[^;]+;/giu,
    (statement, quoted) => {
      if (quoted) return statement;
      const parsed = statement.match(
        /^CREATE POLICY (\w+) ON (\w+)([\s\S]*?) TO ((?:authenticated|service_role|anon)(?:\s*,\s*(?:authenticated|service_role|anon))*)\s+([\s\S]+);$/iu,
      );
      if (!parsed) throw new Error('WIKI_DDL_POLICY_INVALID');
      const [, name, table, settings, roles, expression] = parsed;
      return roles
        .split(',')
        .map((role) => role.trim())
        .map((scope) => {
          if (!scopes.includes(scope))
            throw new Error('WIKI_DDL_POLICY_ROLE_INVALID');
          const alias = `${name}_${scope}`;
          expected.push({
            alias,
            table,
            scope,
            restrictive: settings.includes('AS RESTRICTIVE'),
          });
          return `CREATE POLICY ${alias} ON ${table}${settings} TO ${quote(`${scope}_${online.schema}`)}\n  ${expression};`;
        })
        .join('\n');
    },
  );
  output = output.replace(
    /-- @hierarchical-wiki:prepare-required\nDO \$wiki_prepare\$[\s\S]*?\$wiki_prepare\$;/u,
    '-- Prepared from official dev/online SQL schema metadata.',
  );
  const role = quote(`service_role_${online.schema}`);
  output = output.replace(
    /-- @hierarchical-wiki:runtime-acl:start[\s\S]*?-- @hierarchical-wiki:runtime-acl:end/u,
    [
      'hierarchical_wiki_runtime_owners(varchar,varchar)',
      'hierarchical_wiki_matter_actor(varchar,varchar,varchar,varchar,boolean)',
      'hierarchical_wiki_cleanup(varchar,varchar,varchar,varchar,varchar,varchar)',
    ]
      .map((signature) => `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`)
      .join('\n'),
  );
  const values = expected
    .filter((item) => item.restrictive)
    .map(
      (item) => `('${item.alias}','${item.table}'::regclass,'${item.scope}')`,
    )
    .join(',\n');
  const check = `DO $wiki_sql_boundaries$ BEGIN
    IF EXISTS(SELECT 1 FROM (VALUES ${values}) AS expected(name,relation,scope)
      LEFT JOIN pg_policy p ON p.polname=expected.name AND p.polrelid=expected.relation
      LEFT JOIN pg_roles r ON r.rolname=expected.scope||'_'||current_schema()
      WHERE p.polname IS NULL OR p.polpermissive OR p.polroles IS DISTINCT FROM ARRAY[r.oid]::oid[] OR r.rolsuper OR r.rolbypassrls)
    THEN RAISE EXCEPTION 'WIKI_SQL_BOUNDARY_REQUIRED' USING ERRCODE='42501'; END IF;
  END $wiki_sql_boundaries$;`;
  return output.replace(/COMMIT;\s*$/u, `${check}\nCOMMIT;\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    options = Object.fromEntries(
      args.reduce(
        (entries, key, index) =>
          index % 2 ? entries : [...entries, [key, args[index + 1]]],
        [],
      ),
    );
  if (
    args.length !== 6 ||
    !options['--dev-snapshot'] ||
    !options['--online-snapshot'] ||
    !options['--output']
  )
    throw new Error('WIKI_DDL_PREPARATION_ARGUMENTS_REQUIRED');
  const [template, devSnapshot, onlineSnapshot] = await Promise.all([
    readFile(
      new URL('../migrations/0077_hierarchical_wiki.sql', import.meta.url),
      'utf8',
    ),
    readFile(options['--dev-snapshot'], 'utf8').then(JSON.parse),
    readFile(options['--online-snapshot'], 'utf8').then(JSON.parse),
  ]);
  await writeFile(
    options['--output'],
    prepareHierarchicalWikiDdl({ template, devSnapshot, onlineSnapshot }),
    { flag: 'wx' },
  );
  process.stdout.write(
    'Prepared Hierarchical Wiki SQL from official snapshots. No database statements executed.\n',
  );
}
