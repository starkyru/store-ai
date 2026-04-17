# Message Branching

`createMessageTree()` provides a tree-based conversation history that supports regeneration branches — when the user regenerates a response, both versions are preserved and switchable.

## Basic Usage

```typescript
import { createMessageTree } from '@store-ai/core';

const tree = createMessageTree();

// Add messages in sequence
tree.add(userMessage); // root
tree.add(assistantReply, userMessage.id); // child of user message
```

## Creating Branches

When a user regenerates a response, add a new child to the same parent:

```typescript
// Original reply
tree.add(reply1, userMsg.id);

// User clicks "regenerate" — new branch
tree.add(reply2, userMsg.id);

// Both exist as siblings
tree.getSiblings(reply1.id);
// → [reply1, reply2]
```

## Navigating Branches

```typescript
// Which branch am I on?
tree.getBranchIndex(reply1.id);
// → { current: 0, total: 2 }

// Switch to the next sibling
tree.switchBranch(reply1.id, 'next');
// Now reply2 is the active head

// Get the current conversation path
tree.getActivePath();
// → [userMsg, reply2]
```

## Active Path

The tree always has an "active path" — the linear sequence from root to the current head:

```typescript
tree.getActivePath(); // Message[] — the current conversation view
tree.headId; // string | null — the tip of the active path
tree.setHead(messageId); // jump to any message
```

## Export / Import

Serialize the full tree for persistence:

```typescript
const data = tree.export();
// { nodes: Record<string, MessageNode>, headId: string | null }

// Later — restore
const tree2 = createMessageTree();
tree2.import(data);
```

## UI Integration

Typical branch switcher component:

```typescript
function BranchSwitcher({ messageId }) {
  const { current, total } = tree.getBranchIndex(messageId);
  if (total <= 1) return null;

  return (
    <div>
      <button onClick={() => tree.switchBranch(messageId, 'prev')}>←</button>
      <span>{current + 1} / {total}</span>
      <button onClick={() => tree.switchBranch(messageId, 'next')}>→</button>
    </div>
  );
}
```
