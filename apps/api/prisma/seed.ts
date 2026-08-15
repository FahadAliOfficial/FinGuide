import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.financialProduct.upsert({
    where: { normalizedName: 'home loan' },
    update: { name: 'Home Loan', type: 'LOAN', annualInterestRate: '6.5', isActive: true },
    create: { name: 'Home Loan', normalizedName: 'home loan', type: 'LOAN', annualInterestRate: '6.5' }
  });
} finally {
  await prisma.$disconnect();
}

