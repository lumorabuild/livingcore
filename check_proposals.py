import json, sys
d = json.load(sys.stdin)
for p in d.get('data', []):
    print(f'  #{p["id"]} {p["rule_name"]} status={p["status"]} agent={p["agent"]}')
