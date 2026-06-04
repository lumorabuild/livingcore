with open('src/routes/api.ts') as f:
    lines = f.readlines()
for i in range(154, 165):
    print(f'{i+1}: {lines[i].rstrip()}')
