/**
 * Shareable links: a board, deflated and base64url-encoded, in the URL's
 * fragment. Browsers never send the fragment to the server, so the board stays
 * with whoever has the link.
 */

export interface Shared {
  name: string;
  text: string;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The fragment, without '#', that holds the board. */
export async function encode({ name, text }: Shared): Promise<string> {
  const board = toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
  return new URLSearchParams({ name, board }).toString();
}

/** The board in fragment HASH, or null if it holds none or is damaged. */
export async function decode(hash: string): Promise<Shared | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const board = params.get('board');
  if (!board) return null;
  try {
    const text = new TextDecoder().decode(await pipe(fromBase64Url(board), new DecompressionStream('deflate-raw')));
    return { name: params.get('name') || 'shared.estorm', text };
  } catch {
    return null;
  }
}
