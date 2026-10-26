const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
let schemaContent = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');

const target = `  fareBreakdown           String?
  status                  String                    @default("PENDING") // PENDING, CONFIRMED, CANCELLED, REJECTED`;

const replacement = `  fareBreakdown           String?
  previousFare            Float?                    @default(0)
  fareVersion             Int                       @default(1)
  fareUpdatedAt           DateTime?                 @default(now())
  fareChangeReason        String?
  status                  String                    @default("PENDING") // PENDING, CONFIRMED, CANCELLED, REJECTED`;

if (!schemaContent.includes(target)) {
  console.error("target not found in schema.prisma");
  process.exit(1);
}

schemaContent = schemaContent.replace(target, replacement);
fs.writeFileSync(schemaPath, schemaContent, 'utf8');
console.log("Successfully updated schema.prisma with fare revision fields");
