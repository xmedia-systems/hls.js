import ID3, { utf8ArrayToStr } from '../../../src/demux/id3.js';
import { mockID3Header, mockID3HeaderMissingLeadingByte, mockID3HeaderMissingTrailingByte } from '../utils/mockData';
describe('ID3 tests', function () {
  it('utf8ArrayToStr', function () {
    const aB = new Uint8Array([97, 98]);
    const aNullBNullC = new Uint8Array([97, 0, 98, 0, 99]);

    expect(utf8ArrayToStr(aB)).to.equal('ab');
    expect(utf8ArrayToStr(aNullBNullC)).to.equal('abc');
    expect(utf8ArrayToStr(aNullBNullC, true)).to.equal('a');
  });
  it('Properly parses ID3 Headers', function () {
    expect(ID3.isHeader(mockID3Header, 0)).to.equal(true);
    expect(ID3.isHeader(mockID3HeaderMissingLeadingByte, 0)).to.equal(false);
    expect(ID3.isHeader(mockID3HeaderMissingTrailingByte, 0)).to.equal(true);
  });
  it('Properly parses ID3 Info', function () {
    expect(ID3.canParse(mockID3Header, 0)).to.equal(true);
    expect(ID3.canParse(mockID3HeaderMissingLeadingByte, 0)).to.equal(false);
    expect(ID3.canParse(mockID3HeaderMissingTrailingByte, 0)).to.equal(false);
  });
});
