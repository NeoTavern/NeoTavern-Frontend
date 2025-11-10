export function removeFromArray<T>(arr: T[], item: T): boolean {
  const index = arr.indexOf(item);
  if (index > -1) {
    arr.splice(index, 1);
    return true;
  }
  return false;
}

export function onlyUnique<T>(value: T, index: number, self: T[]): boolean {
  return self.indexOf(value) === index;
}
