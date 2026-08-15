import type { ReactNode } from 'react';

interface MessageContentProps {
  content: string;
  role: 'USER' | 'ASSISTANT';
}

export function MessageContent({ content, role }: MessageContentProps): React.JSX.Element {
  if (role === 'USER') return <p className="user-copy">{content}</p>;

  return <div className="assistant-copy">{parseBlocks(content)}</div>;
}

type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'ordered-list' | 'unordered-list'; lines: string[] }
  | { type: 'heading'; lines: string[] };

function parseBlocks(content: string): ReactNode[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = (): void => {
    if (current && current.lines.length > 0) blocks.push(current);
    current = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (current?.type !== 'ordered-list' && current?.type !== 'unordered-list') flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    const unordered = /^[-•]\s+(.+)$/.exec(line);
    const type: Block['type'] = heading ? 'heading' : ordered ? 'ordered-list' : unordered ? 'unordered-list' : 'paragraph';
    const value = heading?.[2] ?? ordered?.[1] ?? unordered?.[1] ?? line;

    if (!current || current.type !== type || type === 'heading') {
      flush();
      current = { type, lines: [value] };
    } else {
      current.lines.push(value);
    }
  }
  flush();

  return blocks.map((block, index) => {
    const key = `${block.type}-${index}`;
    if (block.type === 'ordered-list') {
      return <ol key={key}>{block.lines.map((line, item) => <li key={item}>{parseInline(line)}</li>)}</ol>;
    }
    if (block.type === 'unordered-list') {
      return <ul key={key}>{block.lines.map((line, item) => <li key={item}>{parseInline(line)}</li>)}</ul>;
    }
    if (block.type === 'heading') return <h3 key={key}>{parseInline(block.lines[0] ?? '')}</h3>;
    return <p key={key}>{parseInline(block.lines.join(' '))}</p>;
  });
}

function parseInline(content: string): ReactNode[] {
  return content.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}
