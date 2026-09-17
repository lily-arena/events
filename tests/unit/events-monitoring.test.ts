import {describe,it,expect} from 'vitest';
import {monitoringStart,monitoringLabel,isTrafficSurging} from '../../packages/domain/src/event-monitoring';
describe('Korean event monitoring intervals',()=>{
 it('starts hourly and daily windows at Korean boundaries',()=>{const now=Date.UTC(2026,8,17,0,12);expect(monitoringStart('hour',now)).toBe(Date.UTC(2026,8,16,1));expect(monitoringStart('day',now)).toBe(Date.UTC(2026,7,18,15));expect(monitoringLabel(now,'hour',true)).toBe('9.17 09시');});
 it('anchors weekly windows on Monday midnight in Korea',()=>{const now=Date.UTC(2026,8,17,0);const latest=monitoringStart('week',now)+11*7*86400000;expect(latest).toBe(Date.UTC(2026,8,13,15));});
 it('does not imply surge without a meaningful baseline and absolute floor',()=>{expect(isTrafficSurging(null)).toBe(false);const base={current:100,previous:0,from:0,to:0};expect(isTrafficSurging(base)).toBe(false);expect(isTrafficSurging({...base,previous:33})).toBe(true);expect(isTrafficSurging({...base,current:99,previous:1})).toBe(false);expect(isTrafficSurging({...base,previous:40})).toBe(false);});
});
