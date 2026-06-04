import json,sys
d = json.load(sys.stdin)
print('Total turns:', len(d.get('data', [])))
for t in d.get('data', []):
    print(f'  #{t["turn_number"]} {t["speaker"]:8} | {t["content"][:80]}')
