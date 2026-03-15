const { add } = require("../src/math");

test("reports a structured failure when an assertion does not match", () => {
  expect(add(1, 1)).toBe(3);
});

