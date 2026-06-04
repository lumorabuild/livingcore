import json, sys
d = json.load(sys.stdin)
print('Adoptions:', len(d.get('data', [])))
for a in d.get('data', []):
    print(f'  {a["rule_name"]} v{a["from_version"]}->v{a["to_version"]} coherence {a.get("coherence_before","?")}->{a.get("coherence_after","?")}')
