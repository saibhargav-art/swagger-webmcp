import { readFileSync } from 'fs';
import { parseSpec, transformSpec } from '../dist/index.mjs';

const spec = JSON.parse(readFileSync(new URL('./openapi.json', import.meta.url)));

const parsed = await parseSpec(spec);
const { tools, errors } = transformSpec(parsed, {
  // auth: { type: 'bearer', token: 'my-token' },  // uncomment to test auth
  // include: ['pets'],                              // uncomment to filter by tag
});

console.log(`\n✓ Generated ${tools.length} tools\n`);

for (const tool of tools) {
  console.log(`── ${tool.name}`);
  console.log(`   description : ${tool.description.split('\n')[0]}`);

  const props = Object.entries(tool.inputSchema.properties || {});
  if (props.length) {
    console.log(`   parameters  :`);
    for (const [name, def] of props) {
      const required = tool.inputSchema.required?.includes(name) ? ' (required)' : '';
      console.log(`     ${name}: ${def.type}${required}${def.description ? ' — ' + def.description : ''}`);
    }
  } else {
    console.log(`   parameters  : none`);
  }

  console.log();
}

if (errors.length) {
  console.error('Errors:');
  for (const e of errors) console.error(' ', e);
}
