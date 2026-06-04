import json, sys
d = json.load(sys.stdin)
for p in d['data']:
    if p['status'] == 'pending':
        print(f'Proposal #{p["id"]}: status={p["status"]}, name={p["rule_name"]}')
        print(f'  Content first 200 chars: {p["proposed_content"][:200]}')
        try:
            parsed = json.loads(p['proposed_content'])
            print(f'  Parsed OK, version={parsed.get("version")}')
        except Exception as e:
            print(f'  Parse ERROR: {e}')
