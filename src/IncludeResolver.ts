import * as fs from 'fs/promises';
import * as path from 'path';
import { firstBlock } from './DiagramBlock';

// Like PlantUML, take only the first block's body from a file wrapped in @start/@end;
// inlining the wrapper would end the including diagram at the included @end line.
function unwrap(content: string): string {
    const lines = content.split('\n');
    const block = firstBlock(lines);
    if (!block) return content;
    return lines.slice(block.start + 1, block.end < 0 ? undefined : block.end).join('\n');
}

export async function resolveIncludes(
    source: string,
    filePath: string,
    approvedRoots: string[] = [path.dirname(filePath)],
    seen = new Set<string>(),
): Promise<string> {
    const dir = path.dirname(filePath);
    const roots = (await Promise.all(approvedRoots.map(async root => {
        try {
            return await fs.realpath(root);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return undefined;
        }
    }))).filter((root): root is string => root !== undefined);
    const lines = source.split('\n');
    const out: string[] = [];

    for (const line of lines) {
        const m = line.match(/^\s*!include(?:_once)?\s+(.+)$/);
        if (m) {
            const abs = path.resolve(dir, m[1].trim());
            const inside = (candidate: string, root: string) => {
                const relative = path.relative(root, candidate);
                return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
            };
            if (!approvedRoots.some(root => inside(abs, path.resolve(root)))) {
                throw new Error('Include is outside approved roots');
            }
            try {
                const real = await fs.realpath(abs);
                if (!roots.some(root => inside(real, root))) {
                    throw new Error('Include is outside approved roots');
                }
                if (seen.has(real)) continue;
                const content = await fs.readFile(real, 'utf-8');
                seen.add(real);
                out.push(await resolveIncludes(unwrap(content), real, [...new Set([...approvedRoots, ...roots])], seen));
                continue;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                // file not found — pass through to JAR
            }
        }
        out.push(line);
    }

    return out.join('\n');
}
