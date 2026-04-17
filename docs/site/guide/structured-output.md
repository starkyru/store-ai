# Structured Output

store-ai can incrementally parse and validate JSON responses during streaming using the `validateSchema` middleware and the built-in partial JSON parser.

## Basic Usage

```typescript
import { createAIStore, validateSchema, openai } from '@store-ai/core';
import { z } from 'zod';

const RecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      amount: z.string(),
    }),
  ),
  steps: z.array(z.string()),
  servings: z.number(),
});

const store = createAIStore({
  provider: openai(),
  middleware: [validateSchema(RecipeSchema)],
});

store.submit({ message: 'Give me a recipe for pasta carbonara' });
```

## Partial vs Final Objects

During streaming, the store exposes two fields:

- **`partialObject`** -- incrementally parsed and validated against `schema.deepPartial()`. Updates as new JSON chunks arrive.
- **`object`** -- the final, fully validated result. Only set after the stream completes and the full JSON passes Zod validation.

```typescript
// During streaming
store.subscribe('partialObject', (partial) => {
  console.log(partial);
  // { title: "Pasta Carbonara", ingredients: [{ name: "spaghetti" }] }
  // More fields appear as the stream progresses
});

// After completion
store.subscribe('object', (obj) => {
  if (obj) {
    console.log(obj); // Full Recipe, validated against the schema
  }
});
```

## With React

```tsx
import { useAIObject, useAIStatus } from '@store-ai/react';

function RecipeDisplay() {
  const partial = useAIObject<Recipe>(store);
  const status = useAIStatus(store);

  if (!partial) return null;

  return (
    <div>
      {partial.title && <h1>{partial.title}</h1>}
      <ul>
        {partial.ingredients?.map((ing, i) => (
          <li key={i}>
            {ing?.name}: {ing?.amount}
          </li>
        ))}
      </ul>
      {status === 'complete' && <p>Serves: {partial.servings}</p>}
    </div>
  );
}
```

## Partial JSON Parser

The core exports `createPartialJSONParser` for direct use outside the middleware pipeline:

```typescript
import { createPartialJSONParser } from '@store-ai/core';

const parser = createPartialJSONParser<MyType>();
parser.push('{"name": "Jo'); // { name: "Jo" }
parser.push('hn", "age": 3'); // { name: "John", age: 3 }
parser.push('0}'); // { name: "John", age: 30 }
parser.getFinal(); // { name: "John", age: 30 }
parser.reset();
```

The parser uses a state machine that tracks JSON nesting context and appends closing tokens to produce valid JSON at any point. Total work across all chunks is O(n), not O(n^2).
