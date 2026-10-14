import React from "react";
import renderer, { act } from "react-test-renderer";
import { TouchableOpacity, Text } from "react-native";
import AdminTestUsers from "../AdminTestUsers";
import { getAdminTestUsers, createAdminTestUsers, disableAdminTestUsers } from "../../utils/api";
import { newTestUserBatch } from "../../utils/adminTestUsers";
jest.mock("../../utils/api",()=>({getAdminTestUsers:jest.fn(),createAdminTestUsers:jest.fn(),disableAdminTestUsers:jest.fn()}));
jest.mock("../../utils/adminTestUsers",()=>({newTestUserBatch:jest.fn(),testUsersCsv:jest.fn()}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let tree;
const draft = {batchId:"11111111-2222-4333-8444-555555555555",passwords:Array.from({length:50},(_,i)=>`T_${String(i).padStart(48,'0')}`)};
const result = {batchId:draft.batchId,accounts:draft.passwords.map((_,i)=>({id:String(i),email:`test${i}@example.invalid`})),createdAt:"2026-10-02",disabledAt:null};
const button = id => tree.root.findAllByType(TouchableOpacity).find(node=>node.props.testID===id);
const press = id => act(async()=>button(id).props.onPress());
const mount = async () => act(async()=>{tree=renderer.create(<AdminTestUsers token="token" />);});
beforeEach(()=>{jest.resetAllMocks();getAdminTestUsers.mockResolvedValue({enabled:true,batches:[]});newTestUserBatch.mockReturnValue(draft);createAdminTestUsers.mockResolvedValue(result);disableAdminTestUsers.mockResolvedValue({...result,disabledAt:"now"});});
afterEach(async()=>{if(tree) await act(async()=>tree.unmount());tree=null;});
test("feature flag hides the launcher",async()=>{getAdminTestUsers.mockResolvedValue({enabled:false,batches:[]});await mount();expect(button("admin-test-users-open")).toBeUndefined();});
test("unknown create outcome retries identical credentials rather than generating a second batch",async()=>{
 createAdminTestUsers.mockRejectedValueOnce(new Error("networkError")); await mount();await press("admin-test-users-open");await press("admin-test-users-create");await press("admin-test-users-create");
 expect(newTestUserBatch).toHaveBeenCalledTimes(1);expect(createAdminTestUsers.mock.calls).toEqual([["token",draft],["token",draft]]);expect(button("admin-test-users-export")).toBeTruthy();
 const text=tree.root.findAllByType(Text).map(node=>node.props.children).join(" ");expect(text).not.toContain(draft.passwords[0]);
});
test("batch disable requires explicit second confirmation and removes credential export",async()=>{
 await mount();await press("admin-test-users-open");await press("admin-test-users-create");await press(`test-batch-disable-${draft.batchId}`);
 expect(disableAdminTestUsers).not.toHaveBeenCalled();await press("admin-test-users-confirm");expect(disableAdminTestUsers).toHaveBeenCalledWith("token",draft.batchId);expect(button("admin-test-users-export")).toBeUndefined();
});
test("duplicate create clicks while pending send only one batch",async()=>{
 let resolve;createAdminTestUsers.mockReturnValue(new Promise(done=>{resolve=done;}));await mount();await press("admin-test-users-open");
 await act(async()=>{button("admin-test-users-create").props.onPress();button("admin-test-users-create").props.onPress();});
 expect(createAdminTestUsers).toHaveBeenCalledTimes(1);await act(async()=>resolve(result));
});

test("changing account clears in-memory credentials and ignores the previous account's late response",async()=>{
 let resolve;createAdminTestUsers.mockReturnValue(new Promise(done=>{resolve=done;}));await mount();await press("admin-test-users-open");await act(async()=>{button("admin-test-users-create").props.onPress();});
 await act(async()=>tree.update(<AdminTestUsers token="different-token" />));await press("admin-test-users-open");
 await act(async()=>resolve(result));
 expect(button("admin-test-users-export")).toBeUndefined();expect(button(`test-batch-disable-${draft.batchId}`)).toBeUndefined();
 expect(button("admin-test-users-create")).toBeTruthy();expect(getAdminTestUsers).toHaveBeenLastCalledWith("different-token");
});
