console.log(
  Object.keys(process.env)
    .filter((key) => /DATABASE|POSTGRES/u.test(key))
    .sort()
    .join(","),
);
