export function output(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

export function outputList(data: unknown, label = 'items') {
  const obj = data as Record<string, unknown>;
  if (obj?.data && Array.isArray(obj.data)) {
    console.error(`${(obj.total as number) ?? obj.data.length} ${label}`);
    console.log(JSON.stringify(obj.data, null, 2));
  } else if (Array.isArray(data)) {
    console.error(`${data.length} ${label}`);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
