test("the runner timeout interrupts long-running Jest tasks", async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  expect(true).toBe(true);
});
