// Validates every node of the workflow against the real node type descriptions shipped with n8n.
// Usage (needs the n8n package somewhere, e.g. `npm i n8n` in a temp dir):
//   NODE_PATH=/tmp/n8n-validate/node_modules node workflows/src/validate.js workflows/poster_workflow.json
// - parameters the node type does not know (would be silently dropped by n8n) → error
// - getNodeParametersIssues (missing required params, invalid options) → error
const fs = require('fs');
const path = require('path');
const { NodeHelpers } = require(require.resolve('n8n-workflow', { paths: [require.resolve('n8n')] }));

const basePkg = path.dirname(require.resolve('n8n-nodes-base/package.json', { paths: [require.resolve('n8n')] }));
const pkg = require(path.join(basePkg, 'package.json'));
const nodeFiles = pkg.n8n.nodes;
const byType = {};
for (const f of nodeFiles) {
  const mod = require(path.join(basePkg, f));
  for (const k of Object.keys(mod)) {
    try {
      const inst = new mod[k]();
      const name = inst.description?.name || (inst.description?.defaultVersion !== undefined && inst.description.name);
      if (name) byType[`n8n-nodes-base.${name}`] = inst;
    } catch (e) {}
  }
}

function descFor(inst, version) {
  if (inst.nodeVersions) {
    const v = inst.nodeVersions[version];
    if (!v) throw new Error(`version ${version} not available (have ${Object.keys(inst.nodeVersions)})`);
    return v.description;
  }
  const versions = [].concat(inst.description.version);
  if (!versions.includes(version)) throw new Error(`version ${version} not in ${versions}`);
  return inst.description;
}

function diff(input, resolved, prefix = '') {
  const out = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const k of Object.keys(input)) {
      if (!(k in (resolved || {}))) out.push(prefix + k);
      else if (input[k] && typeof input[k] === 'object') out.push(...diff(input[k], resolved[k], `${prefix}${k}.`));
    }
  } else if (Array.isArray(input)) {
    input.forEach((v, i) => out.push(...diff(v, (resolved || [])[i], `${prefix}${i}.`)));
  }
  return out;
}

const wf = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let errors = 0;
for (const node of wf.nodes) {
  const inst = byType[node.type];
  if (!inst) {
    console.log(`✗ ${node.name}: unknown node type ${node.type}`);
    errors++;
    continue;
  }
  let desc;
  try {
    desc = descFor(inst, node.typeVersion);
  } catch (e) {
    console.log(`✗ ${node.name}: ${e.message}`);
    errors++;
    continue;
  }
  const resolved = NodeHelpers.getNodeParameters(desc.properties, node.parameters, true, false, node, desc);
  const dropped = diff(node.parameters, resolved).filter((p) => !/^conditions\.(options|conditions)\b/.test(p));
  const issues = NodeHelpers.getNodeParametersIssues(desc.properties, node, desc);
  const credNeeded = (desc.credentials || []).map((c) => c.name);
  const problems = [];
  if (dropped.length) problems.push(`dropped params: ${dropped.join(', ')}`);
  if (issues && issues.parameters) problems.push(`issues: ${JSON.stringify(issues.parameters)}`);
  if (problems.length) {
    errors++;
    console.log(`✗ ${node.name} (${node.type}@${node.typeVersion}): ${problems.join(' | ')}`);
  } else {
    console.log(`✓ ${node.name}`);
  }
}
console.log(errors ? `\n${errors} node(s) with problems` : '\nALL NODES VALID');
process.exit(errors ? 1 : 0);
