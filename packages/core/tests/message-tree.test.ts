import { describe, it, expect } from 'vitest';
import { createMessageTree } from '../src/message-tree.js';
import type { Message } from '../src/types.js';

// ── Helpers ──

let _counter = 0;

function makeMessage(overrides?: Partial<Message>): Message {
  const id = overrides?.id ?? `msg-${++_counter}`;
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: `message ${id}` }],
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──

describe('createMessageTree', () => {
  // 1. Add messages in sequence → getActivePath returns them in order
  describe('sequential messages', () => {
    it('getActivePath returns messages in order', () => {
      const tree = createMessageTree();
      const m1 = makeMessage({ id: 'a', role: 'user' });
      const m2 = makeMessage({ id: 'b', role: 'assistant' });
      const m3 = makeMessage({ id: 'c', role: 'user' });

      tree.add(m1);
      tree.add(m2, 'a');
      tree.add(m3, 'b');

      const path = tree.getActivePath();
      expect(path).toHaveLength(3);
      expect(path[0]!.id).toBe('a');
      expect(path[1]!.id).toBe('b');
      expect(path[2]!.id).toBe('c');
    });

    it('headId tracks the last added message', () => {
      const tree = createMessageTree();
      const m1 = makeMessage({ id: 'x' });
      const m2 = makeMessage({ id: 'y' });

      tree.add(m1);
      expect(tree.headId).toBe('x');

      tree.add(m2, 'x');
      expect(tree.headId).toBe('y');
    });
  });

  // 2. Add branching message (same parent, different child) → both exist
  describe('branching messages', () => {
    it('two children of the same parent both exist as nodes', () => {
      const tree = createMessageTree();
      const parent = makeMessage({ id: 'parent' });
      const branchA = makeMessage({ id: 'branch-a', role: 'assistant' });
      const branchB = makeMessage({ id: 'branch-b', role: 'assistant' });

      tree.add(parent);
      tree.add(branchA, 'parent');
      tree.add(branchB, 'parent');

      expect(tree.getNode('branch-a')).toBeDefined();
      expect(tree.getNode('branch-b')).toBeDefined();

      const parentNode = tree.getNode('parent')!;
      expect(parentNode.childIds).toContain('branch-a');
      expect(parentNode.childIds).toContain('branch-b');
    });

    it('head moves to the most recently added branch', () => {
      const tree = createMessageTree();
      const parent = makeMessage({ id: 'p' });
      const a = makeMessage({ id: 'a1' });
      const b = makeMessage({ id: 'b1' });

      tree.add(parent);
      tree.add(a, 'p');
      expect(tree.headId).toBe('a1');

      tree.add(b, 'p');
      expect(tree.headId).toBe('b1');
    });
  });

  // 3. getSiblings returns all children of same parent
  describe('getSiblings', () => {
    it('returns all children of the same parent', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'root' }));
      tree.add(makeMessage({ id: 'c1' }), 'root');
      tree.add(makeMessage({ id: 'c2' }), 'root');
      tree.add(makeMessage({ id: 'c3' }), 'root');

      const siblings = tree.getSiblings('c2');
      expect(siblings).toHaveLength(3);
      expect(siblings.map((s) => s.id)).toEqual(['c1', 'c2', 'c3']);
    });

    it('returns root siblings for root-level messages', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r1' }));
      tree.add(makeMessage({ id: 'r2' }));

      const siblings = tree.getSiblings('r1');
      expect(siblings).toHaveLength(2);
      expect(siblings.map((s) => s.id)).toEqual(['r1', 'r2']);
    });

    it('returns empty array for unknown message', () => {
      const tree = createMessageTree();
      expect(tree.getSiblings('nonexistent')).toEqual([]);
    });
  });

  // 4. getBranchIndex returns correct current/total
  describe('getBranchIndex', () => {
    it('returns correct index and total', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'parent' }));
      tree.add(makeMessage({ id: 'b0' }), 'parent');
      tree.add(makeMessage({ id: 'b1' }), 'parent');
      tree.add(makeMessage({ id: 'b2' }), 'parent');

      expect(tree.getBranchIndex('b0')).toEqual({ current: 0, total: 3 });
      expect(tree.getBranchIndex('b1')).toEqual({ current: 1, total: 3 });
      expect(tree.getBranchIndex('b2')).toEqual({ current: 2, total: 3 });
    });

    it('returns {current: 0, total: 1} for only child', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'p' }));
      tree.add(makeMessage({ id: 'only' }), 'p');

      expect(tree.getBranchIndex('only')).toEqual({ current: 0, total: 1 });
    });
  });

  // 5. switchBranch('next') / switchBranch('prev') works
  describe('switchBranch', () => {
    it('next moves to the next sibling and sets head', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'p' }));
      tree.add(makeMessage({ id: 's0' }), 'p');
      tree.add(makeMessage({ id: 's1' }), 'p');
      tree.add(makeMessage({ id: 's2' }), 'p');

      const result = tree.switchBranch('s0', 'next');
      expect(result).toBe('s1');
      expect(tree.headId).toBe('s1');
    });

    it('prev moves to the previous sibling', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'p' }));
      tree.add(makeMessage({ id: 's0' }), 'p');
      tree.add(makeMessage({ id: 's1' }), 'p');

      const result = tree.switchBranch('s1', 'prev');
      expect(result).toBe('s0');
      expect(tree.headId).toBe('s0');
    });

    it('returns null when at boundary', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'p' }));
      tree.add(makeMessage({ id: 'first' }), 'p');
      tree.add(makeMessage({ id: 'last' }), 'p');

      expect(tree.switchBranch('first', 'prev')).toBeNull();
      expect(tree.switchBranch('last', 'next')).toBeNull();
    });

    it('follows deepest descendant when switching branches', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'root' }));

      // Branch A: root -> a1 -> a2 -> a3
      tree.add(makeMessage({ id: 'a1' }), 'root');
      tree.add(makeMessage({ id: 'a2' }), 'a1');
      tree.add(makeMessage({ id: 'a3' }), 'a2');

      // Branch B: root -> b1 -> b2
      tree.add(makeMessage({ id: 'b1' }), 'root');
      tree.add(makeMessage({ id: 'b2' }), 'b1');

      // Switch from a1 to b1 (siblings under root)
      const result = tree.switchBranch('a1', 'next');
      // Should land on the deepest descendant of b1
      expect(result).toBe('b2');
      expect(tree.headId).toBe('b2');
    });
  });

  // 6. setHead changes active path
  describe('setHead', () => {
    it('changes the active head', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r' }));
      tree.add(makeMessage({ id: 'a' }), 'r');
      tree.add(makeMessage({ id: 'b' }), 'r');

      expect(tree.headId).toBe('b');

      tree.setHead('a');
      expect(tree.headId).toBe('a');
    });

    it('throws for unknown message id', () => {
      const tree = createMessageTree();
      expect(() => tree.setHead('nonexistent')).toThrow('not found');
    });
  });

  // 7. getActivePath after branch switch returns correct messages
  describe('getActivePath after branch switch', () => {
    it('returns the path through the switched branch', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'root' }));

      // Branch A
      tree.add(makeMessage({ id: 'a1' }), 'root');
      tree.add(makeMessage({ id: 'a2' }), 'a1');

      // Branch B
      tree.add(makeMessage({ id: 'b1' }), 'root');
      tree.add(makeMessage({ id: 'b2' }), 'b1');

      // Head is at b2 (last added)
      expect(tree.getActivePath().map((m) => m.id)).toEqual(['root', 'b1', 'b2']);

      // Switch to branch A by setting head to a2
      tree.setHead('a2');
      expect(tree.getActivePath().map((m) => m.id)).toEqual(['root', 'a1', 'a2']);
    });

    it('returns correct path after switchBranch', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r' }));
      tree.add(makeMessage({ id: 'x1' }), 'r');
      tree.add(makeMessage({ id: 'x2' }), 'x1');
      tree.add(makeMessage({ id: 'y1' }), 'r');
      tree.add(makeMessage({ id: 'y2' }), 'y1');

      // Currently at y2
      tree.switchBranch('y1', 'prev'); // switch from y1 to x1, lands on x2

      expect(tree.getActivePath().map((m) => m.id)).toEqual(['r', 'x1', 'x2']);
    });
  });

  // 8. export/import round-trip preserves tree structure
  describe('export/import', () => {
    it('round-trip preserves tree structure', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r' }));
      tree.add(makeMessage({ id: 'a' }), 'r');
      tree.add(makeMessage({ id: 'b' }), 'r');
      tree.add(makeMessage({ id: 'b1' }), 'b');

      tree.setHead('b1');

      const exported = tree.export();

      // Create a new tree and import
      const tree2 = createMessageTree();
      tree2.import(exported);

      expect(tree2.size).toBe(4);
      expect(tree2.headId).toBe('b1');
      expect(tree2.getActivePath().map((m) => m.id)).toEqual(['r', 'b', 'b1']);
      expect(tree2.getSiblings('a').map((m) => m.id)).toEqual(['a', 'b']);
      expect(tree2.getRoots().map((m) => m.id)).toEqual(['r']);
    });

    it('import clears previous state', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'old' }));

      const tree2 = createMessageTree();
      tree2.add(makeMessage({ id: 'new' }));

      tree.import(tree2.export());

      expect(tree.size).toBe(1);
      expect(tree.getNode('old')).toBeUndefined();
      expect(tree.getNode('new')).toBeDefined();
    });
  });

  // 9. getRoots returns root messages
  describe('getRoots', () => {
    it('returns all root-level messages', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r1' }));
      tree.add(makeMessage({ id: 'r2' }));
      tree.add(makeMessage({ id: 'child' }), 'r1');

      const roots = tree.getRoots();
      expect(roots).toHaveLength(2);
      expect(roots.map((r) => r.id)).toEqual(['r1', 'r2']);
    });

    it('returns empty array for empty tree', () => {
      const tree = createMessageTree();
      expect(tree.getRoots()).toEqual([]);
    });
  });

  // 10. size tracks total nodes
  describe('size', () => {
    it('tracks total node count', () => {
      const tree = createMessageTree();
      expect(tree.size).toBe(0);

      tree.add(makeMessage({ id: 'm1' }));
      expect(tree.size).toBe(1);

      tree.add(makeMessage({ id: 'm2' }), 'm1');
      expect(tree.size).toBe(2);

      tree.add(makeMessage({ id: 'm3' }), 'm1');
      expect(tree.size).toBe(3);
    });
  });

  // 11. Deep branching (3+ levels) works correctly
  describe('deep branching', () => {
    it('handles 3+ levels of nesting', () => {
      const tree = createMessageTree();

      // Level 0: root
      tree.add(makeMessage({ id: 'L0' }));

      // Level 1: two branches from root
      tree.add(makeMessage({ id: 'L1-a' }), 'L0');
      tree.add(makeMessage({ id: 'L1-b' }), 'L0');

      // Level 2: two branches from L1-a
      tree.add(makeMessage({ id: 'L2-a1' }), 'L1-a');
      tree.add(makeMessage({ id: 'L2-a2' }), 'L1-a');

      // Level 3: branch from L2-a1
      tree.add(makeMessage({ id: 'L3-a1x' }), 'L2-a1');
      tree.add(makeMessage({ id: 'L3-a1y' }), 'L2-a1');

      // Verify structure
      expect(tree.size).toBe(7);

      // Navigate to deep branch
      tree.setHead('L3-a1x');
      expect(tree.getActivePath().map((m) => m.id)).toEqual(['L0', 'L1-a', 'L2-a1', 'L3-a1x']);

      // Siblings at level 3
      expect(tree.getSiblings('L3-a1x').map((m) => m.id)).toEqual(['L3-a1x', 'L3-a1y']);

      // Switch branch at level 1 (L1-a -> L1-b) should find deepest descendant
      tree.setHead('L3-a1x');
      const newHead = tree.switchBranch('L1-a', 'next');
      // L1-b has no children, so it is its own deepest descendant
      expect(newHead).toBe('L1-b');
      expect(tree.getActivePath().map((m) => m.id)).toEqual(['L0', 'L1-b']);

      // Switch back
      const backHead = tree.switchBranch('L1-b', 'prev');
      // L1-a's last child is L2-a2 (added after L2-a1), and L2-a2 has no children
      expect(backHead).toBe('L2-a2');
      expect(tree.getActivePath().map((m) => m.id)).toEqual(['L0', 'L1-a', 'L2-a2']);
    });

    it('branch index works at every level', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'r' }));
      tree.add(makeMessage({ id: 'a' }), 'r');
      tree.add(makeMessage({ id: 'b' }), 'r');
      tree.add(makeMessage({ id: 'a1' }), 'a');
      tree.add(makeMessage({ id: 'a2' }), 'a');
      tree.add(makeMessage({ id: 'a3' }), 'a');

      expect(tree.getBranchIndex('r')).toEqual({ current: 0, total: 1 });
      expect(tree.getBranchIndex('a')).toEqual({ current: 0, total: 2 });
      expect(tree.getBranchIndex('b')).toEqual({ current: 1, total: 2 });
      expect(tree.getBranchIndex('a1')).toEqual({ current: 0, total: 3 });
      expect(tree.getBranchIndex('a2')).toEqual({ current: 1, total: 3 });
      expect(tree.getBranchIndex('a3')).toEqual({ current: 2, total: 3 });
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('getActivePath returns empty array for empty tree', () => {
      const tree = createMessageTree();
      expect(tree.getActivePath()).toEqual([]);
      expect(tree.headId).toBeNull();
    });

    it('add throws for duplicate message id', () => {
      const tree = createMessageTree();
      tree.add(makeMessage({ id: 'dup' }));
      expect(() => tree.add(makeMessage({ id: 'dup' }))).toThrow('already exists');
    });

    it('add throws for nonexistent parent', () => {
      const tree = createMessageTree();
      expect(() => tree.add(makeMessage({ id: 'child' }), 'no-parent')).toThrow('not found');
    });

    it('getNode returns undefined for unknown id', () => {
      const tree = createMessageTree();
      expect(tree.getNode('nope')).toBeUndefined();
    });

    it('switchBranch returns null for unknown message', () => {
      const tree = createMessageTree();
      expect(tree.switchBranch('nonexistent', 'next')).toBeNull();
    });
  });
});
