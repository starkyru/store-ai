import type { Message } from './types.js';

export interface MessageNode {
  message: Message;
  parentId: string | null;
  childIds: string[];
}

export interface MessageTree {
  /** Add a message as a child of parentId (or root if null). */
  add(message: Message, parentId?: string | null): void;

  /** Get a specific node. */
  getNode(id: string): MessageNode | undefined;

  /** Get the current linear path from root to the active head. */
  getActivePath(): Message[];

  /** Get the active head message ID. */
  readonly headId: string | null;

  /** Set the active head to a specific message. Recalculates the active path. */
  setHead(messageId: string): void;

  /** Get sibling messages (same parent). Useful for showing branch switcher UI. */
  getSiblings(messageId: string): Message[];

  /** Get the branch index: which sibling is this message among its siblings? */
  getBranchIndex(messageId: string): { current: number; total: number };

  /** Switch to the next/previous sibling branch. */
  switchBranch(messageId: string, direction: 'next' | 'prev'): string | null;

  /** Get all root-level messages. */
  getRoots(): Message[];

  /** Get total message count. */
  readonly size: number;

  /** Export the full tree for serialization. */
  export(): { nodes: Record<string, MessageNode>; headId: string | null };

  /** Import a previously exported tree. */
  import(data: { nodes: Record<string, MessageNode>; headId: string | null }): void;
}

export function createMessageTree(): MessageTree {
  const nodes = new Map<string, MessageNode>();
  const rootIds: string[] = [];
  let _headId: string | null = null;

  function add(message: Message, parentId?: string | null): void {
    const resolvedParentId = parentId ?? null;

    if (nodes.has(message.id)) {
      throw new Error(`Message with id "${message.id}" already exists in the tree`);
    }

    if (resolvedParentId !== null) {
      const parent = nodes.get(resolvedParentId);
      if (!parent) {
        throw new Error(`Parent message with id "${resolvedParentId}" not found`);
      }
      parent.childIds.push(message.id);
    } else {
      rootIds.push(message.id);
    }

    nodes.set(message.id, {
      message,
      parentId: resolvedParentId,
      childIds: [],
    });

    _headId = message.id;
  }

  function getNode(id: string): MessageNode | undefined {
    return nodes.get(id);
  }

  function getPathToRoot(messageId: string): Message[] {
    const path: Message[] = [];
    let currentId: string | null = messageId;

    while (currentId !== null) {
      const node = nodes.get(currentId);
      if (!node) break;
      path.push(node.message);
      currentId = node.parentId;
    }

    return path.reverse();
  }

  function getActivePath(): Message[] {
    if (_headId === null) return [];
    return getPathToRoot(_headId);
  }

  function setHead(messageId: string): void {
    const node = nodes.get(messageId);
    if (!node) {
      throw new Error(`Message with id "${messageId}" not found`);
    }
    _headId = messageId;
  }

  function getSiblingIds(messageId: string): string[] {
    const node = nodes.get(messageId);
    if (!node) return [];

    if (node.parentId === null) {
      return rootIds;
    }

    const parent = nodes.get(node.parentId);
    if (!parent) return [];
    return parent.childIds;
  }

  function getSiblings(messageId: string): Message[] {
    return getSiblingIds(messageId)
      .map((id) => nodes.get(id)?.message)
      .filter((m): m is Message => m !== undefined);
  }

  function getBranchIndex(messageId: string): { current: number; total: number } {
    const siblingIds = getSiblingIds(messageId);
    const index = siblingIds.indexOf(messageId);
    return {
      current: index === -1 ? 0 : index,
      total: siblingIds.length,
    };
  }

  function getDeepestDescendant(messageId: string): string {
    let currentId = messageId;

    while (true) {
      const node = nodes.get(currentId);
      if (!node || node.childIds.length === 0) break;
      // Follow the last child (most recently added branch)
      currentId = node.childIds[node.childIds.length - 1]!;
    }

    return currentId;
  }

  function switchBranch(messageId: string, direction: 'next' | 'prev'): string | null {
    const siblingIds = getSiblingIds(messageId);
    const currentIndex = siblingIds.indexOf(messageId);

    if (currentIndex === -1) return null;

    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (nextIndex < 0 || nextIndex >= siblingIds.length) return null;

    const targetSiblingId = siblingIds[nextIndex]!;
    const newHeadId = getDeepestDescendant(targetSiblingId);
    _headId = newHeadId;
    return newHeadId;
  }

  function getRoots(): Message[] {
    return rootIds.map((id) => nodes.get(id)?.message).filter((m): m is Message => m !== undefined);
  }

  function exportTree(): { nodes: Record<string, MessageNode>; headId: string | null } {
    const record: Record<string, MessageNode> = {};
    for (const [id, node] of nodes) {
      record[id] = {
        message: node.message,
        parentId: node.parentId,
        childIds: [...node.childIds],
      };
    }
    return { nodes: record, headId: _headId };
  }

  function importTree(data: { nodes: Record<string, MessageNode>; headId: string | null }): void {
    nodes.clear();
    rootIds.length = 0;

    for (const [id, node] of Object.entries(data.nodes)) {
      nodes.set(id, {
        message: node.message,
        parentId: node.parentId,
        childIds: [...node.childIds],
      });

      if (node.parentId === null) {
        rootIds.push(id);
      }
    }

    _headId = data.headId;
  }

  return {
    add,
    getNode,
    getActivePath,
    get headId() {
      return _headId;
    },
    setHead,
    getSiblings,
    getBranchIndex,
    switchBranch,
    getRoots,
    get size() {
      return nodes.size;
    },
    export: exportTree,
    import: importTree,
  };
}
