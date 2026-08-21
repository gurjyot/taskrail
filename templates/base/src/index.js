export function main() {
  return 'ok';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve(main()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
