import latestTime from './helpers/latestTime';
import advanceBlock from './helpers/advanceToBlock';
import { increaseTimeTo, duration } from './helpers/increaseTime';
import ether from './helpers/ether';
import EVMRevert from './helpers/EVMRevert';

const MonoretoCrowdsale = artifacts.require('MonoretoIco');
const MonoretoToken = artifacts.require('MonoretoToken');

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

const BigNumber = web3.BigNumber;

contract('MonoretoIco', function ([owner, wallet, investor, team, project, bounty]) {

    const USDETH = new BigNumber(528);
    const USDMNR = new BigNumber(5263);
    const SOFTCAP = ether(3788);
    const HARDCAP = ether(28410);
    const ONE_HUNDRED_PERCENT = new BigNumber(100);

    const TOKEN_CAP = new BigNumber(5 * (10 ** 26));
    const TOKEN_TARGET = new BigNumber(TOKEN_CAP.times(57).div(100).toFixed(0));

    const SINGLE_ETHER = new BigNumber(web3.toWei(1, "ether"));

    before(async function() {
        await advanceBlock();
	BigNumber.config({ DECIMAL_PLACES: 18 });
    });

    beforeEach(async function () {
        this.startTime = latestTime() + duration.hours(1);
        this.endTime = this.startTime + duration.days(30);
        this.afterEndTime = this.endTime + duration.seconds(1);

        this.bonusTimes = [
            duration.days(1),
            duration.days(3),
            duration.days(10),
            duration.days(17),
        ];

        this.bonusTimesPercents = [
            new BigNumber(120), new BigNumber(115), 
            new BigNumber(110), new BigNumber(105)
        ];

        this.token = await MonoretoToken.new(TOKEN_CAP);
        this.crowdsale = await MonoretoCrowdsale.new(
            this.startTime, this.endTime,
            USDETH, USDMNR, 
            SOFTCAP, HARDCAP, 
            TOKEN_TARGET, 
            wallet, 
            this.token.address
        );


        this.token = MonoretoToken.at(await this.crowdsale.token());
	this.token.transferOwnership(this.crowdsale.address);
    });

    it("should create crowdsale with correct parameters", async function () {
        this.crowdsale.should.exist;
        this.token.should.exist;

        const startTime = await this.crowdsale.openingTime();
        const endTime = await this.crowdsale.closingTime();
        const usdMnr = await this.crowdsale.usdMnr();
        const usdEth = await this.crowdsale.usdEth();
        const walletAddress = await this.crowdsale.wallet();
        const goal = await this.crowdsale.goal();
        const cap = await this.crowdsale.cap();

        startTime.should.be.bignumber.equal(this.startTime);
        endTime.should.be.bignumber.equal(this.endTime);
        usdMnr.should.be.bignumber.equal(USDMNR);
        usdEth.should.be.bignumber.equal(USDETH);
        walletAddress.should.be.equal(wallet);
        goal.should.be.bignumber.equal(SOFTCAP);
        cap.should.be.bignumber.equal(HARDCAP);
    });

    it("should not create crowdsale if hardcap is less than softcap", async function() {
        await MonoretoCrowdsale.new(
            this.startTime, this.endTime,
            USDETH, USDMNR, 
            HARDCAP, SOFTCAP,
            TOKEN_TARGET, 
            wallet,
            this.token.address
        ).should.be.rejectedWith(EVMRevert);
    });

    it("should not allow to call finalize before crowdsale end", async function() {
        await increaseTimeTo(this.startTime);
        await this.crowdsale.finalize().should.be.rejectedWith(EVMRevert);
    });

    it("should not allow to send ether before crowdsale beginning and after crowdsale end", async function() {
	await increaseTimeTo(this.startTime);
        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER }).should.be.rejectedWith(EVMRevert);
        await increaseTimeTo(this.afterEndTime);
        this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER }).should.be.rejectedWith(EVMRevert);
    });

    it("should allow to call the finalize function after crowdsale end", async function() {
	this.crowdsale.setAdditionalWallets(team, bounty);
        await increaseTimeTo(this.afterEndTime);

        (await this.crowdsale.hasClosed()).should.be.true;
        await this.crowdsale.finalize().should.be.fulfilled;
        (await this.crowdsale.isFinalized()).should.be.true;
    });

    it("should set bonuses only from owner", async function() {
        await increaseTimeTo(this.startTime);
        this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents, { from: investor }).should.be.rejectedWith(EVMRevert);
    });

    it("should refund if goal is not reached", async function() {
        await increaseTimeTo(this.startTime);

        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents).should.be.fulfilled;

        await this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER, gasPrice: 0 });

        let balanceBeforeRefund = await web3.eth.getBalance(investor.toString());

        await increaseTimeTo(this.afterEndTime);
	const isGoalReached = await this.crowdsale.goalReached();
        isGoalReached.should.be.false;
	this.crowdsale.setAdditionalWallets(team, bounty);

        await this.crowdsale.finalize();
        await this.crowdsale.claimRefund({ from: investor, gasPrice: 0 });

        let balanceAfterRefund = await web3.eth.getBalance(investor);

        balanceAfterRefund.minus(balanceBeforeRefund).should.be.bignumber.equal(SINGLE_ETHER);
    });

    it("should not refund if goal is reached", async function() {
        await increaseTimeTo(this.startTime);

        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        await this.crowdsale.send(SOFTCAP, { from: investor });

        await increaseTimeTo(this.afterEndTime);
	this.crowdsale.setAdditionalWallets(team, bounty);
        (await this.crowdsale.goalReached()).should.be.true;

        this.crowdsale.claimRefund({ from: investor }).should.be.rejectedWith(EVMRevert);
    });

    it("should not accept payments less than 0.1 ETH", async function() {
        await increaseTimeTo(this.startTime);
        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        await this.crowdsale.sendTransaction({ from: investor, value: new BigNumber(web3.toWei(99, 'finney')) }).should.be.rejectedWith(EVMRevert);
    });

    it("should set bonus times and values in percents", async function() {
        await increaseTimeTo(this.startTime);

        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        let bonusTimesSet = await this.crowdsale.getBonusTimes();
        let bonusTimesPercentsSet = await this.crowdsale.getBonusTimesPercents();

        for (var i = 0; i < this.bonusTimes.length; i++) {
            bonusTimesSet[i].should.be.bignumber.equal(this.bonusTimes[i]);
            bonusTimesPercentsSet[i].should.be.bignumber.equal(this.bonusTimesPercents[i]);
        }
    });

    it('should pay bonus that depends on date participated', async function() {
        let timesForRewind = [
            this.startTime + duration.hours(2),
            this.startTime + duration.days(2), 
            this.startTime + duration.days(4),
            this.startTime + duration.days(11),
            this.startTime + duration.days(20)
        ];

        await increaseTimeTo(this.startTime);

        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        const rate = new BigNumber(USDETH.times(100000).div(USDMNR).toFixed(0));

        for (var i = 0; i < timesForRewind.length; i++) {
            await increaseTimeTo(timesForRewind[i]);
            let oldBalance = await this.token.balanceOf(investor);

            await this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER }).should.be.fulfilled;

            var tokenBalanceOfInvestor = await this.token.balanceOf(investor);

            var balance = tokenBalanceOfInvestor.minus(oldBalance);
            var currentBonusPercents = this.bonusTimesPercents[i] || new BigNumber('100');
            
	    var expectedNumberOfTokens = SINGLE_ETHER.times(USDETH).times(100000)
			.times(currentBonusPercents).div(ONE_HUNDRED_PERCENT).div(USDMNR).toFixed(0);

            balance.should.be.bignumber.equal(expectedNumberOfTokens);
        }
    });

    it('should finish crowdsale as soon as hardcap is collected', async function() {
        await increaseTimeTo(this.startTime);
        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);
	this.crowdsale.setAdditionalWallets(team, bounty);

        await this.crowdsale.sendTransaction({ from: investor, value: HARDCAP });
        (await this.crowdsale.capReached()).should.be.true;

	await this.crowdsale.finalize({ from: owner }).should.be.fulfilled;
    });

    it("should not refund if crowdsale is in progress", async function() {
        await increaseTimeTo(this.startTime);
        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

        await this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER });

        this.crowdsale.claimRefund({ from: investor }).should.be.rejectedWith(EVMRevert);
    });

    it("should not accept any payments unless bonuses are set", async function() {
        await increaseTimeTo(this.startTime);
        this.crowdsale.sendTransaction({ from: investor, value: SINGLE_ETHER }).should.be.rejectedWith(EVMRevert);
    });

    it("should not allow to finalize unless team and bounty wallets are set", async function() {
	await increaseTimeTo(this.afterEndTime);

	this.crowdsale.finalize({ from: owner }).should.be.rejectedWith(EVMRevert);
    });

    it('should mint 23% tokens for project needs, 11% for team and 3% for bounty after the end of crowdsale', async function() {
        await increaseTimeTo(this.startTime);
        await this.crowdsale.setBonusTimes(this.bonusTimes, this.bonusTimesPercents);

	this.crowdsale.setAdditionalWallets(team, bounty);
        // Crowdsale is required to be ended and goal has to be reached
        await this.crowdsale.sendTransaction({ from: investor, value: SOFTCAP }).should.be.fulfilled;
        await increaseTimeTo(this.afterEndTime);

        await this.crowdsale.finalize({ from: owner }).should.be.fulfilled;

	const RATE = USDETH.times(100000).div(USDMNR);
        const TWENTY_THREE_PCT_MULT = new BigNumber(23).div(ONE_HUNDRED_PERCENT);
        const ELEVEN_PCT_MULT = new BigNumber(11).div(ONE_HUNDRED_PERCENT);
        const THREE_PCT_MULT = new BigNumber(3).div(ONE_HUNDRED_PERCENT);
        const BONUS_PCT = this.bonusTimesPercents[0].div(ONE_HUNDRED_PERCENT);

	const tokenCap = await this.token.cap();

        let expectedProjectTokens = tokenCap.times(TWENTY_THREE_PCT_MULT);
        let expectedTeamTokens = tokenCap.times(ELEVEN_PCT_MULT);
	let expectedBountyTokens = tokenCap.times(THREE_PCT_MULT);

        expectedProjectTokens.should.be.bignumber.equal(await this.token.balanceOf(wallet));
        expectedTeamTokens.should.be.bignumber.equal(await this.token.balanceOf(team));
        expectedBountyTokens.should.be.bignumber.equal(await this.token.balanceOf(bounty));

        (await this.token.mintingFinished()).should.be.true;
        owner.should.be.equal(await this.token.owner());

	await this.token.mint(owner, 1, { from: owner }).should.be.rejectedWith(EVMRevert);
    });

});

