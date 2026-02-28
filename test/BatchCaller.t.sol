// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BatchCaller} from "../src/BatchCaller.sol";

contract Counter {
    uint256 public count;

    function increment() external {
        count++;
    }

    function incrementBy(uint256 n) external {
        count += n;
    }

    function mustFail() external pure {
        revert("boom");
    }
}

contract BatchCallerTest is Test {
    BatchCaller batchCaller;
    Counter counter;

    function setUp() public {
        batchCaller = new BatchCaller();
        counter = new Counter();
    }

    function test_ExecuteSingleCall() public {
        BatchCaller.Call[] memory calls = new BatchCaller.Call[](1);
        calls[0] = BatchCaller.Call({target: address(counter), data: abi.encodeCall(Counter.increment, ())});

        vm.prank(address(batchCaller));
        batchCaller.execute(calls);

        assertEq(counter.count(), 1);
    }

    function test_ExecuteMultipleCalls() public {
        BatchCaller.Call[] memory calls = new BatchCaller.Call[](3);
        for (uint256 i = 0; i < 3; i++) {
            calls[i] = BatchCaller.Call({target: address(counter), data: abi.encodeCall(Counter.increment, ())});
        }

        vm.prank(address(batchCaller));
        batchCaller.execute(calls);

        assertEq(counter.count(), 3);
    }

    function test_RevertsWhenCalledByNonSelf() public {
        BatchCaller.Call[] memory calls = new BatchCaller.Call[](0);

        vm.prank(address(0xdead));
        vm.expectRevert(BatchCaller.OnlyCallableBySelf.selector);
        batchCaller.execute(calls);
    }

    function test_RevertsOnFailedSubcall() public {
        BatchCaller.Call[] memory calls = new BatchCaller.Call[](2);
        calls[0] = BatchCaller.Call({target: address(counter), data: abi.encodeCall(Counter.increment, ())});
        calls[1] = BatchCaller.Call({target: address(counter), data: abi.encodeCall(Counter.mustFail, ())});

        vm.prank(address(batchCaller));
        vm.expectRevert(
            abi.encodeWithSelector(BatchCaller.CallFailed.selector, 1, abi.encodeWithSignature("Error(string)", "boom"))
        );
        batchCaller.execute(calls);

        assertEq(counter.count(), 0, "state should have been reverted");
    }

    function test_EmptyCallsArray() public {
        BatchCaller.Call[] memory calls = new BatchCaller.Call[](0);

        vm.prank(address(batchCaller));
        batchCaller.execute(calls);
    }
}
