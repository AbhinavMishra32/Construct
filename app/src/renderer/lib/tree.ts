import type { TreeNode, WorkspaceFileEntry } from "../types";

type MutableTreeNode = TreeNode & {
  childrenMap?: Map<string, MutableTreeNode>;
};

export function buildWorkspaceTree(entries: WorkspaceFileEntry[]): TreeNode[] {
  const rootMap = new Map<string, MutableTreeNode>();

  const sortedEntries = [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });

  for (const entry of sortedEntries) {
    const segments = entry.path.split("/");
    let currentMap = rootMap;
    let currentPath = "";

    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      const kind = isLeaf ? entry.kind : "directory";
      const size = isLeaf ? entry.size : 0;
      let node = currentMap.get(segment);

      if (!node) {
        node = {
          name: segment,
          path: currentPath,
          kind,
          size,
          children: [],
          childrenMap: new Map()
        };
        currentMap.set(segment, node);
      }

      if (isLeaf && node.kind !== entry.kind) {
        node.kind = entry.kind;
        node.size = entry.size;
      }

      currentMap = node.childrenMap ?? new Map();
      node.childrenMap = currentMap;
    }
  }

  return finalizeTree([...rootMap.values()]);
}

function finalizeTree(nodes: MutableTreeNode[]): TreeNode[] {
  return nodes
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    })
    .map((node) => ({
      name: node.name,
      path: node.path,
      kind: node.kind,
      size: node.size,
      children: finalizeTree([...(node.childrenMap?.values() ?? [])])
    }));
}

