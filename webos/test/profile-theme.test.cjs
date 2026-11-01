const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/core.js");
test("profile holiday themes use bounded windows and reset outside them", () => {
  for (const [date, theme] of [
    ["2026-10-16", ""],
    ["2026-10-17", "harvest"],
    ["2026-11-01", "harvest"],
    ["2026-11-03", "harvest"],
    ["2026-11-12", "harvest"],
    ["2026-11-28", "snowfall"],
    ["2026-11-29", "snowfall"],
    ["2026-12-11", "snowfall"],
    ["2027-01-02", "snowfall"],
    ["2027-01-05", "snowfall"],
    ["2027-01-06", ""],
    ["2027-01-13", ""],
    ["2026-03-22", "bloom"],
    ["2026-04-07", "bloom"],
    ["2026-04-16", "bloom"],
    ["2026-04-17", ""],
    ["2027-03-28", "bloom"],
  ])
    assert.equal(
      C.profileHolidayTheme(new Date(date + "T12:00:00")),
      theme,
      date,
    );
});
