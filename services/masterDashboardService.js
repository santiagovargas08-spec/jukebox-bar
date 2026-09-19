'use strict';

const { prisma } = require('../db.js');

async function getMasterDashboardStats() {
  const [barGroups, licenseGroups] = await Promise.all([
    prisma.bar.groupBy({
      by: ['active'],
      _count: {
        _all: true
      }
    }),
    prisma.license.groupBy({
      by: ['status'],
      _count: {
        _all: true
      }
    })
  ]);

  let active = 0;
  let inactive = 0;

  for (const group of barGroups) {
    if (group.active) {
      active += group._count._all;
    } else {
      inactive += group._count._all;
    }
  }

  const licenseCounts = new Map(
    licenseGroups.map((group) => [
      group.status,
      group._count._all
    ])
  );

  return {
    total: active + inactive,
    active,
    inactive,
    trial: licenseCounts.get('TRIAL') || 0,
    activeLicense: licenseCounts.get('ACTIVE') || 0,
    expired: licenseCounts.get('EXPIRED') || 0,
    suspended: licenseCounts.get('SUSPENDED') || 0
  };
}

module.exports = {
  getMasterDashboardStats
};
