

let test_text = "Hello World!";
if (test_text.startsWith("/")) {
    console.log(test_text);
}

test_text = "/compact";
if (test_text.startsWith("/")) {
    console.log(test_text);
}

const list = Array.from({ length: 6 });

let a = 0;
let b = 1;
let sum = 0;

for (let i = 0; i < list.length; i++) {
    let c = a + b;
    sum += c;
    console.log(c);
    a = b;
    b = c;
}
console.log(sum);

