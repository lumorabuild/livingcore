import json, sys
d = json.load(sys.stdin)
print('Rules:', len(d.get('data', [])))
for r in d.get('data', []):
    print(f'  {r["name"]} v{r["version"]} active={r["is_active"]} id={r["id"]}')
