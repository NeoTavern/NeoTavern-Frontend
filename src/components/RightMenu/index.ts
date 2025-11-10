import { CharactersBlock } from './CharactersBlock';
import { RightMenu_HotSwap } from './HotSwap';

export class RightMenu {
  readonly hotSwap: RightMenu_HotSwap;
  readonly charactersBlock: CharactersBlock;
  constructor() {
    this.hotSwap = new RightMenu_HotSwap();
    this.charactersBlock = new CharactersBlock();
  }

  async init() {
    await this.charactersBlock.init();
  }
}
