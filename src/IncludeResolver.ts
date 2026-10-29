import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { firstBlock } from './DiagramBlock';

// PlantUML includes each file once, but only where an !include is actually reached
// (a file can sit in several !if branches). Deduplicating here, before !if is
// evaluated, would drop it from whichever branch is active, so each inlined copy
// carries a preprocessor guard and PlantUML skips the repeats itself.
function guard(realPath: string, content: string): string {
    const id = `$__include_${createHash('sha1').update(realPath).digest('hex').slice(0, 12)}`;
    return `!if %not(%variable_exists("${id}"))\n!global ${id} = %true()\n${content}\n!endif`;
}

// Like PlantUML, take only the first block's body from a file wrapped in @start/@end;
// inlining the wrapper would end the including diagram at the included @end line.
function unwrap(content: string): string {
    const lines = content.split('\n');
    const block = firstBlock(lines);
    if (!block) return content;
    return lines.slice(block.start + 1, block.end < 0 ? undefined : block.end).join('\n');
}

// Lines that open or close a block whose body may run zero or many times.
// A one-line `!function $f() !return …` opens nothing.
const OPENS = /^\s*!(?:if|ifdef|ifndef|while|foreach|procedure|function|unquoted\s+(?:procedure|function))\b(?!.*!return\b)/i;
const CLOSES = /^\s*!(?:endif|endwhile|endfor|endprocedure|endfunction)\b/i;

interface State {
    ancestors: Set<string>;
    /** Open conditional/loop/procedure blocks enclosing the current line, across all including files */
    depth: number;
    /** Files already inlined outside any such block: PlantUML is certain to skip any later copy */
    unconditional: Set<string>;
}

export function resolveIncludes(
    source: string,
    filePath: string,
    approvedRoots: string[] = [path.dirname(filePath)],
): Promise<string> {
    return resolve(source, filePath, approvedRoots, { ancestors: new Set(), depth: 0, unconditional: new Set() });
}

async function resolve(
    source: string,
    filePath: string,
    approvedRoots: string[],
    state: State,
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
    let depth = state.depth;

    for (const line of lines) {
        if (OPENS.test(line)) depth++;
        else if (CLOSES.test(line)) depth = Math.max(state.depth, depth - 1);
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
                if (state.ancestors.has(real) || state.unconditional.has(real)) continue; // cycle, or certain repeat
                const content = await fs.readFile(real, 'utf-8');
                const nested = await resolve(unwrap(content), real, [...new Set([...approvedRoots, ...roots])], {
                    ...state, ancestors: new Set([...state.ancestors, real]), depth,
                });
                if (depth === 0) state.unconditional.add(real);
                out.push(guard(real, nested));
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
