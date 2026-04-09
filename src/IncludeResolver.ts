import * as fs from 'fs/promises';
import * as path from 'path';

export async function resolveIncludes(
    source: string,
    filePath: string,
    seen = new Set<string>(),
): Promise<string> {
    const dir = path.dirname(filePath);
    const lines = source.split('\n');
    const out: string[] = [];

    for (const line of lines) {
        const m = line.match(/^\s*!include\s+(.+)$/);
        if (m) {
            const abs = path.resolve(dir, m[1].trim());
            if (seen.has(abs)) continue;
            try {
                const content = await fs.readFile(abs, 'utf-8');
                seen.add(abs);
                out.push(await resolveIncludes(content, abs, seen));
                continue;
            } catch {
                // file not found — pass through to JAR
            }
        }
        out.push(line);
    }

    return out.join('\n');
}
