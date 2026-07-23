const assert = require("assert");
const { hashPassword, verifyPassword } = require("../server");

const encoded = hashPassword("beautiful-flowers");
assert(encoded.includes(":"));
assert(verifyPassword("beautiful-flowers", encoded));
assert(!verifyPassword("wrong-password", encoded));
console.log("Bloom smoke tests passed.");
