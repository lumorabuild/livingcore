import json

with open('debug_state.json') as f:
    d = json.load(f)['data']

logs = d['recent_log']
kl = [l for l in logs if l['agent']=='kevin' and l['detail']]
jl = [l for l in logs if l['agent']=='jenny' and l['detail']]

print(f'Total logs: {len(logs)}')
print(f'Kevin+detail: {len(kl)}')
print(f'Jenny+detail: {len(jl)}')

if kl:
    det = json.loads(kl[-1]['detail'])
    print(f'Has thoughts: {"thoughts" in det}')
    print(f'Preview: {det.get("thoughts","")[:100]}')
else:
    print('No kevin logs with detail found')
    all_kevin = [l for l in logs if l['agent']=='kevin']
    for l in all_kevin:
        print(f'  action={l["action"]}, detail={l["detail"][:50] if l["detail"] else "None"}')
