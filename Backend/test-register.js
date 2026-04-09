require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const email = 'diagnostic@test.com';
  const password = 'testpass123';
  const firstName = 'Test';
  const lastName = 'User';

  try {
    console.log('1. Hashing password...');
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    console.log('2. Generating verification code...');
    const otp = crypto.randomInt(100000, 999999).toString();
    const verificationCodeHash = await bcrypt.hash(otp, 12);
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    console.log('3. Creating pending registration...');
    const pending = await prisma.pendingRegistration.upsert({
      where: { email },
      update: {
        firstName,
        lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        emailVerified: false,
        expiresAt,
        onboardingData: {},
        step: 1
      },
      create: {
        email,
        firstName,
        lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        expiresAt,
        onboardingData: {},
        step: 1
      }
    });

    console.log('✓ Registration successful:', pending.id);
  } catch (err) {
    console.error('✗ Error:', err.message);
    console.error('Code:', err.code);
    console.error('Meta:', err.meta);
  } finally {
    await prisma.$disconnect();
  }
}

main();